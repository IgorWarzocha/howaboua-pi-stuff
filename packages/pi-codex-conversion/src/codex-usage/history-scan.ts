import { addSpend } from "./ledger.ts";
import { emptySummary, type UsageHistoryScan } from "./ledger-schema.ts";
import { scanSessionUsage } from "./session-analysis.ts";

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
