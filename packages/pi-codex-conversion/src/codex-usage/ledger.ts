import { emptyStats, emptySummary, type CodexSpend, type SpendStats, type SpendSummary, type UsageAccount, type UsageLedger, type UsagePeriod } from "./ledger-schema.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TOLERANCE_MS = 60_000;

export function usageAccount(ledger: UsageLedger, key: string, at: number): UsageAccount {
	return ledger.accounts[key] ??= {
		since: at, total: emptySummary(), months: {}, recent: [], closed: {},
		unassignedUsd: 0, missingWeeklyObservations: 0, recordingGaps: 0,
	};
}

function addStats(target: SpendStats, value: SpendStats, sign = 1): void {
	for (const key of Object.keys(target) as (keyof SpendStats)[]) target[key] = Math.max(0, target[key] + sign * value[key]);
}

export function addSpend(summary: SpendSummary, spend: CodexSpend, sign = 1): void {
	addStats(summary.total, spend.stats, sign);
	const key = `model:${spend.model}`;
	addStats(summary.models[key] ??= emptyStats(), spend.stats, sign);
}

export function addSummary(target: SpendSummary, value: SpendSummary): void {
	addStats(target.total, value.total);
	for (const [key, stats] of Object.entries(value.models)) {
		if (!Object.hasOwn(target.models, key)) target.models[key] = emptyStats();
		addStats(target.models[key]!, stats);
	}
}

export function recordSpend(account: UsageAccount, spend: CodexSpend): void {
	addSpend(account.total, spend);
	const month = new Date(spend.at).toISOString().slice(0, 7);
	addSpend(account.months[month] ??= emptySummary(), spend);
	const current = account.current;
	if (current && spend.at >= current.start && spend.at < current.expectedReset) addSpend(current.summary, spend);
	else account.unassignedUsd += spend.stats.usd;
	// A future weekly observation cannot locate a new start earlier than this tail.
	// Older costs remain in totals, months and the provisional period summary.
	account.recent = account.recent.filter(({ at }) => at >= spend.at - WEEK_MS - RESET_TOLERANCE_MS);
	account.recent.push(spend);
}

export function estimatedQuota(period: UsagePeriod): number | undefined {
	if (!period.quota) return undefined;
	if (period.quota.usedPercent === 100) return 100;
	if (period.quotaPerUsd === undefined) return undefined;
	return Math.min(100, period.quota.usedPercent + Math.max(0, period.summary.total.usd - period.quota.usd) * period.quotaPerUsd);
}

function closePeriod(account: UsageAccount, end: number, observedAt: number, reason: "early" | "scheduled" | "gap"): void {
	const period = account.current;
	if (!period) return;
	// Only the recent, unsealed tail is revisited. Closed records are never recalculated.
	for (const spend of account.recent) {
		if (spend.at >= end && spend.at < period.expectedReset && spend.at >= period.start) {
			addSpend(period.summary, spend, -1);
			account.unassignedUsd += spend.stats.usd;
		}
	}
	const key = String(period.start);
	const quotaEstimate = estimatedQuota(period);
	account.closed[key] = { ...period, partial: period.partial || reason === "gap", end, closedAt: observedAt, reason, ...(quotaEstimate === undefined ? {} : { quotaEstimate }) };
	account.previous = key;
}

function startPeriod(account: UsageAccount, start: number, reset: number, source: UsagePeriod["source"]): void {
	const summary = emptySummary();
	account.recent = account.recent.filter(({ at }) => at >= start);
	for (const spend of account.recent) {
		if (spend.at >= start && spend.at < reset) {
			addSpend(summary, spend);
			account.unassignedUsd = Math.max(0, account.unassignedUsd - spend.stats.usd);
		}
	}
	account.current = { start, expectedReset: reset, source, partial: account.since > start, summary };
}

export function observeWeeklyUsage(account: UsageAccount, snapshot: CodexUsageSnapshot, at: number): void {
	const limit = snapshot.limits.find(({ limitId }) => limitId === "codex");
	const weekly = [limit?.primary, limit?.secondary].find((window) => window?.windowMinutes === WEEK_MS / 60_000);
	const reset = weekly?.resetsAt === undefined ? undefined : weekly.resetsAt * 1000;
	// Missing, stale and out-of-order observations must not manufacture windows.
	if (at <= (account.lastObservation ?? 0)) return;
	account.lastObservation = at;
	if (reset === undefined || reset <= at || reset > at + WEEK_MS + RESET_TOLERANCE_MS) {
		account.missingWeeklyObservations++;
		return;
	}
	const start = reset - WEEK_MS;
	const current = account.current;
	const changed = current && Math.abs(reset - current.expectedReset) > RESET_TOLERANCE_MS;
	if (changed) {
		if (start <= current.start || start < (current.quota?.at ?? current.start) - RESET_TOLERANCE_MS) {
			account.missingWeeklyObservations++;
			return;
		}
		const end = Math.min(start, current.expectedReset);
		const reason = start < current.expectedReset - RESET_TOLERANCE_MS ? "early"
			: start > current.expectedReset + RESET_TOLERANCE_MS ? "gap" : "scheduled";
		closePeriod(account, end, at, reason);
	}
	if (!current || changed) {
		const source = account.manualResetAt !== undefined && Math.abs(start - account.manualResetAt) <= RESET_TOLERANCE_MS ? "manual" : "inferred";
		startPeriod(account, start, reset, source);
		delete account.manualResetAt;
	}
	const period = account.current;
	if (!period) return;
	const used = weekly?.usedPercent;
	if (used === undefined || used < 0 || used > 100) {
		account.missingWeeklyObservations++;
		return;
	}
	const previous = period.quota;
	const usd = period.summary.total.usd;
	if (previous && used < previous.usedPercent) {
		// A percentage drop without a changed weekly boundary is ambiguous.
		account.missingWeeklyObservations++;
		delete period.quotaPerUsd;
	} else if (previous && usd > previous.usd && used > previous.usedPercent) {
		period.quotaPerUsd = (used - previous.usedPercent) / (usd - previous.usd);
	} else if (!previous && usd > 0 && used > 0) {
		period.quotaPerUsd = used / usd;
	}
	period.quota = { at, usedPercent: used, usd };
}
