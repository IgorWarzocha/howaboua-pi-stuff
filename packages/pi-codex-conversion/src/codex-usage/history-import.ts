import { addSpend, addSummary } from "./ledger.ts";
import { emptySummary, type UsageAccount, type UsageHistoryScan } from "./ledger-schema.ts";

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
