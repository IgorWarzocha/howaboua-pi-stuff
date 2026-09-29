import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { emptyStats, type SpendStats } from "./ledger-schema.ts";

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function statsFromUsage(value: unknown): SpendStats | undefined {
	const usage = object(value);
	const cost = object(usage?.["cost"]);
	const usd = cost?.["total"];
	const input = usage?.["input"], output = usage?.["output"], cacheRead = usage?.["cacheRead"], cacheWrite = usage?.["cacheWrite"];
	const valid = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0;
	if (!valid(usd) || !valid(input) || !valid(output) || !valid(cacheRead) || !valid(cacheWrite)) return undefined;
	return { usd, input, output, cacheRead, cacheWrite, requests: 1, unpriced: usd === 0 && input + output + cacheRead + cacheWrite > 0 ? 1 : 0 };
}

async function* sessionFiles(root: string, from: number): AsyncGenerator<string> {
	if ((await stat(root)).isFile()) { yield root; return; }
	for (const entry of await readdir(root, { withFileTypes: true })) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) yield* sessionFiles(path, from);
		else if (entry.isFile() && entry.name.endsWith(".jsonl") && (await stat(path)).mtimeMs >= from) yield path;
	}
}

export async function analyseSessions(options: { root: string; from: number; to: number; model?: string | undefined; limit: number }) {
	const groups = new Map<string, { model: string; reasoning: string; reasoningSource: string; stats: SpendStats }>();
	const sessions: { path: string; stats: SpendStats }[] = [];
	const seen = new Set<string>();
	let skippedCopies = 0, incompleteEntries = 0, unattributedUsage = 0;
	const warnings: string[] = [];
	for await (const path of sessionFiles(options.root, options.from)) {
		const levels = new Map<string, string>();
		const sessionStats = emptyStats();
		const input = createReadStream(path, { encoding: "utf8" });
		const lines = createInterface({ input, crlfDelay: Infinity });
		let lineNumber = 0;
		try {
			for await (const line of lines) {
				lineNumber++;
				if (!line.trim()) continue;
				let entry: Record<string, unknown> | undefined;
				try { entry = object(JSON.parse(line)); }
				catch {
					incompleteEntries++;
					if (warnings.length < 10) warnings.push(`Invalid JSON: ${path}:${lineNumber}`);
					continue;
				}
				if (!entry) continue;
				const id = entry["id"], parent = entry["parentId"];
				const inherited = typeof parent === "string" ? levels.get(parent) : undefined;
				const level = entry["type"] === "thinking_level_change" && typeof entry["thinkingLevel"] === "string" ? entry["thinkingLevel"] : inherited;
				if (typeof id === "string" && level) levels.set(id, level);
				const message = entry["type"] === "message" ? object(entry["message"]) : undefined;
				const source = message?.["role"] === "assistant" ? message : entry["type"] === "usage" ? entry : undefined;
				const at = typeof message?.["timestamp"] === "number" ? message["timestamp"] : typeof entry["timestamp"] === "string" ? Date.parse(entry["timestamp"]) : NaN;
				if (!Number.isFinite(at) || at < options.from || at >= options.to) continue;
				if (!source) { if (entry["usage"]) unattributedUsage++; continue; }
				if (message && message["api"] !== "openai-codex-responses") continue;
				if (!message && source["provider"] !== "openai-codex") { unattributedUsage++; continue; }
				const model = source["model"];
				if (typeof model !== "string" || typeof id !== "string") { incompleteEntries++; continue; }
				if (options.model && model !== options.model) continue;
				const stats = statsFromUsage(source["usage"]);
				if (!stats) { incompleteEntries++; continue; }
				const identity = JSON.stringify([id, at, source["provider"], model]);
				if (seen.has(identity)) { skippedCopies++; continue; }
				seen.add(identity);
				const exactLevel = source["providerThinkingLevel"];
				const reasoning = typeof exactLevel === "string" ? exactLevel : message && level ? level : "unknown";
				const reasoningSource = typeof exactLevel === "string" ? "provider" : message && level ? "session-setting" : "unknown";
				const key = JSON.stringify([model, reasoning, reasoningSource]);
				const group = groups.get(key) ?? { model, reasoning, reasoningSource, stats: emptyStats() };
				for (const name of Object.keys(stats) as (keyof SpendStats)[]) {
					group.stats[name] += stats[name];
					sessionStats[name] += stats[name];
				}
				groups.set(key, group);
			}
		} finally { lines.close(); input.destroy(); }
		if (sessionStats.requests) sessions.push({ path, stats: sessionStats });
	}
	return {
		from: new Date(options.from).toISOString(), toExclusive: new Date(options.to).toISOString(),
		scope: "Local Codex session entries, not account-isolated. Independent of the ledger; do not add these totals to it.",
		groups: [...groups.values()].sort((a, b) => b.stats.usd - a.stats.usd),
		sessions: sessions.sort((a, b) => b.stats.usd - a.stats.usd).slice(0, options.limit),
		sessionCount: sessions.length,
		coverage: { skippedCopies, incompleteEntries, unattributedUsage, warnings, unsavedRequests: "not recoverable from sessions" },
	};
}
