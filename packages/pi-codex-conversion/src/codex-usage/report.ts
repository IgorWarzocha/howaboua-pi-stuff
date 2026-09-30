import { backfillUsage } from "./backfill.ts";
import { formatUsageTable, NONSTANDARD_CODEX_USAGE_WARNING } from "./format.ts";
import { estimatedQuota } from "./ledger.ts";
import type { UsageAccount } from "./ledger-schema.ts";
import { readUsageLedger, recordCodexQuota, usageRecordingError } from "./ledger-store.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function captureSpendReport(snapshot: CodexUsageSnapshot, options: {
	sessionDir: string;
	signal?: AbortSignal | undefined;
	onProgress?: (lines: string[]) => void;
}): Promise<string[]> {
	if (!snapshot.accountKey) return [];
	await recordCodexQuota(snapshot);
	try {
		const pending = backfillUsage(snapshot.accountKey, options.sessionDir, options.signal);
		if (pending) {
			options.onProgress?.([...readSpendReport(snapshot.accountKey), "", "Loading history…"]);
			await pending;
		}
	} catch (error) {
		return [...readSpendReport(snapshot.accountKey), `History unavailable: ${error instanceof Error ? error.message : String(error)}`];
	}
	return readSpendReport(snapshot.accountKey);
}

export function readSpendReport(key: string): string[] {
	try {
		const ledger = readUsageLedger();
		const account = ledger.accounts[key];
		const lines = account ? formatSpendReport(usageReport(account)) : ["No tracked spend yet."];
		if (!account?.history && ledger.historyOwner && ledger.historyOwner !== key) lines.push("History linked to another account");
		const error = usageRecordingError();
		return error ? [...lines, error] : lines;
	} catch (error) { return [`Spend unavailable: ${error instanceof Error ? error.message : String(error)}`]; }
}

function difference(currentRate: number | undefined, previousRate: number | undefined): number | undefined {
	return currentRate !== undefined && previousRate !== undefined && previousRate > 0
		? (currentRate / previousRate - 1) * 100 : undefined;
}

export function usageReport(account: UsageAccount, now = Date.now()) {
	const current = account.current;
	const previous = account.previous ? account.closed[account.previous] : undefined;
	const date = new Date(now);
	const thisMonthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
	const previousMonthStart = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1);
	const previousMonthKey = new Date(previousMonthStart).toISOString().slice(0, 7);
	const previousMonth = account.months[previousMonthKey];
	// Coverage diagnostics describe estimates; they do not gate usable recorded totals.
	const currentRate = current && now < current.expectedReset && now > current.start
		? current.summary.total.usd / ((now - current.start) / DAY_MS) : undefined;
	const previousRate = previous && previous.end > previous.start
		? previous.summary.total.usd / ((previous.end - previous.start) / DAY_MS) : undefined;
	const monthRate = previousMonth
		? previousMonth.total.usd / ((thisMonthStart - previousMonthStart) / DAY_MS) : undefined;
	const quotaStale = (account.lastObservation ?? 0) > (current?.quota?.at ?? 0);
	const quota = current && !quotaStale ? estimatedQuota(current) : undefined;
	return {
		since: account.since,
		nonstandard: account.nonstandard === true,
		history: account.history,
		lifetime: account.total.total,
		current,
		previous,
		spendPerDay: currentRate,
		vsPreviousWindowPercent: difference(currentRate, previousRate),
		vsPreviousMonthPercent: difference(currentRate, monthRate),
		previousMonth: previousMonthKey,
		previousMonthApproximate: Boolean(account.history && account.history.from < thisMonthStart && account.history.to > previousMonthStart),
		models: Object.entries(current?.summary.models ?? {}).map(([key, stats]) => ({
			model: key.slice("model:".length), ...stats,
			quotaPercentEstimate: quota !== undefined && current && current.summary.total.usd > 0
				? quota * stats.usd / current.summary.total.usd : undefined,
		})).sort((a, b) => b.usd - a.usd),
		coverage: {
			partialWindow: current?.partial ?? true,
			needsWeeklyObservation: !current || now >= current.expectedReset,
			unassignedUsd: account.unassignedUsd,
			missingWeeklyObservations: account.missingWeeklyObservations,
			quotaStale,
			recordingGaps: account.recordingGaps,
			unpricedRequests: account.total.total.unpriced,
		},
	};
}

export function formatSpendReport(report: ReturnType<typeof usageReport>): string[] {
	const money = (usd: number) => `$${usd.toFixed(2)}`;
	const percent = (value: number) => `${value >= 0 ? "+" : ""}${Math.round(value)}%`;
	const tokens = (value: number) => value >= 1e6 ? `${(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${(value / 1e3).toFixed(1)}k` : String(value);
	const lines = [report.current ? `This window: ${money(report.current.summary.total.usd)} API equivalent` : "No reset window yet"];
	const comparisons: string[] = [];
	if (report.vsPreviousWindowPercent !== undefined && report.previous) {
		const days = (report.previous.end - report.previous.start) / DAY_MS;
		const roundedDays = Number(days.toFixed(1));
		const duration = days < 0.1 ? "<0.1 days" : `${roundedDays} ${roundedDays === 1 ? "day" : "days"}`;
		comparisons.push(`${percent(report.vsPreviousWindowPercent)} vs last window (${duration})`);
	}
	if (report.vsPreviousMonthPercent !== undefined) comparisons.push(`${percent(report.vsPreviousMonthPercent)} vs last month`);
	if (comparisons.length) lines.push(`Spend/day: ${comparisons.join(" · ")}`);
	if (report.models.length) {
		const showQuota = report.models.some((model) => model.quotaPercentEstimate !== undefined);
		const rows = report.models.map((model) => {
			const count = model.input + model.output + model.cacheRead + model.cacheWrite;
			return [model.model, money(model.usd), tokens(count), ...(showQuota ? [model.quotaPercentEstimate === undefined ? "?" : `${model.quotaPercentEstimate.toFixed(1)}%`] : [])];
		});
		lines.push("", ...formatUsageTable(["Model", "Spend", "Tokens", ...(showQuota ? ["Quota"] : [])], rows));
	}
	const status: string[] = [];
	const unreadablePaths = report.history?.coverage.unreadablePaths ?? 0;
	if (unreadablePaths) status.push(`${unreadablePaths} unreadable history ${unreadablePaths === 1 ? "path" : "paths"}`);
	if (report.current && report.coverage.partialWindow) status.push("Partial window");
	if (report.coverage.quotaStale) status.push("Quota unavailable");
	if (report.coverage.unassignedUsd >= 0.005) status.push(`${money(report.coverage.unassignedUsd)} unassigned`);
	if (status.length) lines.push("", status.join(" · "));
	if (report.nonstandard) lines.push("", NONSTANDARD_CODEX_USAGE_WARNING);
	return lines;
}
