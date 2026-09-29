import { estimatedQuota } from "./ledger.ts";
import type { UsageAccount } from "./ledger-schema.ts";
import { readUsageLedger, recordCodexQuota, usageRecordingError } from "./ledger-store.ts";
import type { CodexUsageSnapshot } from "./payload.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

export async function captureSpendReport(snapshot: CodexUsageSnapshot): Promise<string[]> {
	if (!snapshot.accountKey) return [];
	await recordCodexQuota(snapshot);
	return readSpendReport(snapshot.accountKey);
}

export function readSpendReport(key: string): string[] {
	try {
		const account = readUsageLedger().accounts[key];
		const lines = account ? formatSpendReport(usageReport(account)) : ["No tracked spend yet."];
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
	const currentRate = current && !current.partial && !current.summary.total.unpriced && now < current.expectedReset && now > current.start
		? current.summary.total.usd / ((now - current.start) / DAY_MS) : undefined;
	const previousRate = previous && !previous.partial && !previous.summary.total.unpriced && previous.end > previous.start
		? previous.summary.total.usd / ((previous.end - previous.start) / DAY_MS) : undefined;
	const monthRate = account.since <= previousMonthStart && !previousMonth?.total.unpriced
		? (previousMonth?.total.usd ?? 0) / ((thisMonthStart - previousMonthStart) / DAY_MS) : undefined;
	const quotaStale = (account.lastObservation ?? 0) > (current?.quota?.at ?? 0);
	const quota = current && !current.partial && !quotaStale ? estimatedQuota(current) : undefined;
	return {
		since: account.since,
		lifetime: account.total.total,
		current,
		previous,
		spendPerDay: currentRate,
		vsPreviousWindowPercent: difference(currentRate, previousRate),
		vsPreviousMonthPercent: difference(currentRate, monthRate),
		previousMonth: previousMonthKey,
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
	if (report.vsPreviousWindowPercent !== undefined) comparisons.push(`${percent(report.vsPreviousWindowPercent)} vs last window`);
	if (report.vsPreviousMonthPercent !== undefined) comparisons.push(`${percent(report.vsPreviousMonthPercent)} vs last month`);
	if (comparisons.length) lines.push(`Spend/day: ${comparisons.join(" · ")}`);
	if (report.models.length) {
		const showQuota = report.models.some((model) => model.quotaPercentEstimate !== undefined);
		lines.push("", `Model                     Spend       Tokens${showQuota ? "    Quota ~" : ""}`);
		for (const model of report.models) {
			const count = model.input + model.output + model.cacheRead + model.cacheWrite;
			const quota = showQuota ? `  ${model.quotaPercentEstimate === undefined ? "?" : `${model.quotaPercentEstimate.toFixed(1)}%`}` : "";
			lines.push(`${model.model.padEnd(22)}${money(model.usd).padStart(9)} ${tokens(count).padStart(12)}${quota}`);
		}
	}
	const status: string[] = [];
	if (report.current && report.coverage.partialWindow) status.push("Partial window");
	if (report.coverage.quotaStale) status.push("Quota unavailable");
	if (report.coverage.unassignedUsd > 0) status.push(`${money(report.coverage.unassignedUsd)} unassigned`);
	if (report.coverage.unpricedRequests) status.push("Missing prices");
	if (report.coverage.recordingGaps) status.push("Recording gaps");
	if (status.length) lines.push("", status.join(" · "));
	return lines;
}
