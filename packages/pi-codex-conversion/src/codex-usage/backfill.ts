import { spawn } from "node:child_process";
import { isAbsolute, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { addSpend, addSummary, WEEK_MS } from "./ledger.ts";
import { emptySummary, parseUsageHistory, type UsageAccount, type UsageHistoryScan } from "./ledger-schema.ts";
import { readUsageLedger, updateUsageLedger } from "./ledger-store.ts";
import { scanSessionUsage } from "./session-analysis.ts";

const scans = new Map<string, Promise<void>>();

export async function scanUsageHistory(root: string, from: number, to: number, windowStart: number): Promise<UsageHistoryScan> {
	const total = emptySummary(), previous = emptySummary();
	const months: UsageHistoryScan["months"] = {};
	const recent: UsageHistoryScan["recent"] = [];
	let nonstandard = false;
	const coverage = await scanSessionUsage({ root, from, to }, ({ at, model, stats, nonstandard: custom }) => {
		nonstandard ||= custom;
		const spend = { at, model, stats };
		addSpend(total, spend);
		addSpend(months[new Date(at).toISOString().slice(0, 7)] ??= emptySummary(), spend);
		if (at < windowStart) addSpend(previous, spend);
		else recent.push(spend);
	});
	recent.sort((a, b) => a.at - b.at);
	return { from, to, windowStart, root, total, months, previous, recent, coverage, ...(nonstandard ? { nonstandard } : {}) };
}

export function importUsageHistory(account: UsageAccount, history: UsageHistoryScan, at: number): void {
	if (account.history) return;
	if (history.to !== account.since) throw new Error("Usage history cutoff changed; refresh to retry.");
	const current = account.current;
	if (!current) throw new Error("A weekly observation is required before importing history.");
	if (current.start !== history.windowStart) throw new Error("Reset window changed during history import; refresh to retry.");
	// Do not seal an empty failed scan; a later refresh can still recover its history.
	if (!history.total.total.requests && history.coverage.unreadablePaths)
		throw new Error("No usage history could be recovered from unreadable paths; restore access and refresh to retry.");
	const incomplete = history.coverage.incompleteEntries > 0 || (history.coverage.unreadablePaths ?? 0) > 0;
	if (history.nonstandard) account.nonstandard = true;
	addSummary(account.total, history.total);
	for (const [month, summary] of Object.entries(history.months)) addSummary(account.months[month] ??= emptySummary(), summary);
	let unassignedUsd = history.previous.total.usd;
	const previousKey = String(history.from);
	if (!account.previous && !account.closed[previousKey]) {
		account.closed[previousKey] = {
			start: history.from, end: history.windowStart, expectedReset: history.windowStart, source: "session-history", reason: "backfill",
			closedAt: at, partial: history.previous.total.requests === 0 || incomplete,
			approximate: true, summary: history.previous,
		};
		account.previous = previousKey;
		unassignedUsd = 0;
	}
	let currentUsd = 0;
	for (const spend of history.recent) {
		if (spend.at < current.start || spend.at >= current.expectedReset) { unassignedUsd += spend.stats.usd; continue; }
		addSpend(current.summary, spend);
		account.recent.push(spend);
		currentUsd += spend.stats.usd;
	}
	account.recent.sort((a, b) => a.at - b.at);
	if (history.recent.length) current.approximate = true;
	current.partial = incomplete || account.recordingGaps > 0 || current.summary.total.requests === 0;
	if (current.quota) {
		current.quota.usd += currentUsd;
		if (current.quota.usd > 0 && current.quota.usedPercent > 0) current.quotaPerUsd = current.quota.usedPercent / current.quota.usd;
	}
	account.unassignedUsd += unassignedUsd;
	account.since = history.from;
	account.history = {
		from: history.from, to: history.to, windowStart: history.windowStart, root: history.root, coverage: history.coverage,
		importedAt: at, accountIdentity: "unverified",
	};
}

function scanInChild(root: string, from: number, to: number, windowStart: number, signal: AbortSignal): Promise<UsageHistoryScan> {
	const script = fileURLToPath(new URL(`./analyse.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url));
	return new Promise((resolve, reject) => {
		const child = spawn("node", [script, "history", "--root", root, "--from", new Date(from).toISOString(), "--to", new Date(to).toISOString(), "--window-start", new Date(windowStart).toISOString()], {
			stdio: ["ignore", "pipe", "pipe"], signal,
		});
		let output = "", error = "", bytes = 0;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			bytes += Buffer.byteLength(chunk);
			if (bytes > 32 * 1024 * 1024) {
				child.kill();
				reject(new Error("Session history exceeds the 32 MiB import limit; no history was imported."));
			} else output += chunk;
		});
		child.stderr.on("data", (chunk: string) => { error = (error + chunk).slice(-4096); });
		child.once("error", reject);
		child.once("close", (code) => {
			if (code !== 0) { reject(new Error(error.trim() || `Session history scan exited ${code}`)); return; }
			try { resolve(parseUsageHistory(JSON.parse(output))); }
			catch (failure) { reject(failure); }
		});
	});
}

export function backfillUsage(key: string, sessionDir: string, signal?: AbortSignal): Promise<void> | undefined {
	const running = scans.get(key);
	if (running) return running;
	const ledger = readUsageLedger();
	const account = ledger.accounts[key];
	if (!account?.current || account.history || (ledger.historyOwner && ledger.historyOwner !== key)) return;
	const { start } = account.current;
	const from = start - WEEK_MS, to = account.since;
	if (to <= from) return;
	const standardRoot = join(getAgentDir(), "sessions");
	const path = relative(standardRoot, sessionDir);
	const root = path.startsWith("..") || isAbsolute(path) ? sessionDir : standardRoot;
	const boundedSignal = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(120_000)]);
	const task = (async () => {
		let reserved = false;
		await updateUsageLedger(key, Date.now(), (current, document) => {
			boundedSignal.throwIfAborted();
			if (current.history || (document.historyOwner && document.historyOwner !== key)) return;
			// The first viewer keeps ownership across interruptions; that account can retry.
			document.historyOwner = key;
			reserved = true;
		});
		if (!reserved) return;
		const history = await scanInChild(root, from, to, start, boundedSignal);
		boundedSignal.throwIfAborted();
		await updateUsageLedger(key, Date.now(), (current, document) => {
			boundedSignal.throwIfAborted();
			if (current.history || (document.historyOwner && document.historyOwner !== key)) return;
			importUsageHistory(current, history, Date.now());
		});
	})().finally(() => { if (scans.get(key) === task) scans.delete(key); });
	scans.set(key, task);
	return task;
}
