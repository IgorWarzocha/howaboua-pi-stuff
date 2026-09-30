import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { emptyStats, type CodexSpend, type SpendStats } from "./ledger-schema.ts";

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

async function* sessionFiles(root: string, from: number, unreadable: (path: string, error: unknown) => void): AsyncGenerator<string> {
	let entries;
	try {
		if ((await stat(root)).isFile()) { yield root; return; }
		entries = await readdir(root, { withFileTypes: true });
	} catch (error) { unreadable(root, error); return; }
	for (const entry of entries) {
		const path = join(root, entry.name);
		if (entry.isDirectory()) yield* sessionFiles(path, from, unreadable);
		else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
			let modified;
			try { modified = (await stat(path)).mtimeMs; }
			catch (error) { unreadable(path, error); continue; }
			if (modified >= from) yield path;
		}
	}
}

interface SessionUsageOptions { root: string; from: number; to: number; model?: string | undefined }
interface SessionSpend extends CodexSpend { path: string; reasoning: string; reasoningSource: string; nonstandard: boolean }

export async function scanSessionUsage(options: SessionUsageOptions, visit: (spend: SessionSpend) => void) {
	const seen = new Set<string>();
	const sessions = new Set<string>();
	let skippedCopies = 0, incompleteEntries = 0, unattributedUsage = 0, unreadablePaths = 0;
	const warnings: string[] = [];
	const unreadable = (path: string, error: unknown) => {
		unreadablePaths++;
		if (warnings.length < 10) warnings.push(`Cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	};
	for await (const path of sessionFiles(options.root, options.from, unreadable)) {
		const levels = new Map<string, string>();
		const input = createReadStream(path, { encoding: "utf8" });
		const lines = createInterface({ input, crlfDelay: Infinity });
		let readError: Error | undefined;
		input.on("error", (error) => { readError = error; lines.close(); });
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
				// The entry is persisted after settlement; message.timestamp can be request start.
				// A settlement cutoff keeps live ledger requests out of a historical import.
				const at = typeof entry["timestamp"] === "string" ? Date.parse(entry["timestamp"]) : typeof message?.["timestamp"] === "number" ? message["timestamp"] : NaN;
				if (!Number.isFinite(at) || at < options.from || at >= options.to) continue;
				if (!source) { if (entry["usage"]) unattributedUsage++; continue; }
				if (message && message["api"] !== "openai-codex-responses") continue;
				if (!message && source["api"] !== "openai-codex-responses" && source["provider"] !== "openai-codex") { unattributedUsage++; continue; }
				const model = source["model"];
				if (typeof model !== "string" || typeof id !== "string") { incompleteEntries++; continue; }
				if (options.model && model !== options.model) continue;
				const stats = statsFromUsage(source["usage"]);
				if (!stats) { incompleteEntries++; continue; }
				const identity = typeof source["responseId"] === "string" ? JSON.stringify([source["provider"], source["responseId"]])
					: JSON.stringify([id, message?.["timestamp"] ?? at, source["provider"], model]);
				if (seen.has(identity)) { skippedCopies++; continue; }
				seen.add(identity);
				const exactLevel = source["providerThinkingLevel"];
				const reasoning = typeof exactLevel === "string" ? exactLevel : message && level ? level : "unknown";
				const reasoningSource = typeof exactLevel === "string" ? "provider" : message && level ? "session-setting" : "unknown";
				visit({ at, model, stats, path, reasoning, reasoningSource, nonstandard: source["provider"] !== "openai-codex" });
				sessions.add(path);
			}
		} catch (error) {
			if (!readError || error !== readError) throw error;
		} finally { lines.close(); input.destroy(); }
		if (readError) unreadable(path, readError);
	}
	return { sessions: sessions.size, skippedCopies, incompleteEntries, unattributedUsage, unreadablePaths, warnings };
}

export async function analyseSessions(options: SessionUsageOptions & { limit: number }) {
	const groups = new Map<string, { model: string; reasoning: string; reasoningSource: string; stats: SpendStats }>();
	const sessions = new Map<string, SpendStats>();
	let nonstandard = false;
	const coverage = await scanSessionUsage(options, ({ model, reasoning, reasoningSource, stats, path, nonstandard: custom }) => {
		nonstandard ||= custom;
		const key = JSON.stringify([model, reasoning, reasoningSource]);
		const group = groups.get(key) ?? { model, reasoning, reasoningSource, stats: emptyStats() };
		const session = sessions.get(path) ?? emptyStats();
		for (const name of Object.keys(stats) as (keyof SpendStats)[]) {
			group.stats[name] += stats[name];
			session[name] += stats[name];
		}
		groups.set(key, group);
		sessions.set(path, session);
	});
	return {
		from: new Date(options.from).toISOString(), toExclusive: new Date(options.to).toISOString(),
		nonstandard,
		scope: "Local Codex session entries, not account-isolated. Independent of the ledger; do not add these totals to it.",
		groups: [...groups.values()].sort((a, b) => b.stats.usd - a.stats.usd),
		sessions: [...sessions].map(([path, stats]) => ({ path, stats })).sort((a, b) => b.stats.usd - a.stats.usd).slice(0, options.limit),
		sessionCount: sessions.size,
		coverage: { ...coverage, unsavedRequests: "not recoverable from sessions" },
	};
}
