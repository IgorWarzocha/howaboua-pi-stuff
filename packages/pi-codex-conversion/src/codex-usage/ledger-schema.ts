import { Type, type Static } from "typebox";
import { Check } from "typebox/value";

const number = Type.Number({ minimum: 0 });
const Stats = Type.Object({
	usd: number, input: number, output: number, cacheRead: number, cacheWrite: number,
	requests: number, unpriced: number,
});
const Summary = Type.Object({ total: Stats, models: Type.Record(Type.String(), Stats) });
const Spend = Type.Object({ at: number, model: Type.String(), stats: Stats });
const Quota = Type.Object({ at: number, usedPercent: Type.Number({ minimum: 0, maximum: 100 }), usd: number });
const HistoryCoverage = Type.Object({ sessions: number, skippedCopies: number, incompleteEntries: number, unattributedUsage: number, unreadablePaths: Type.Optional(number), warnings: Type.Array(Type.String()) });
const History = Type.Object({
	from: number, to: number, windowStart: number, root: Type.String(), coverage: HistoryCoverage,
});
const HistoryScan = Type.Object({
	...History.properties, total: Summary, months: Type.Record(Type.String(), Summary), previous: Summary, recent: Type.Array(Spend),
	nonstandard: Type.Optional(Type.Boolean()),
});
const Period = Type.Object({
	start: number, expectedReset: number,
	source: Type.Union([Type.Literal("inferred"), Type.Literal("manual"), Type.Literal("session-history")]),
	partial: Type.Boolean(), summary: Summary,
	approximate: Type.Optional(Type.Boolean()),
	quota: Type.Optional(Quota), quotaPerUsd: Type.Optional(number),
});
const ClosedPeriod = Type.Object({
	...Period.properties,
	end: number, closedAt: number,
	reason: Type.Union([Type.Literal("scheduled"), Type.Literal("early"), Type.Literal("gap"), Type.Literal("backfill")]),
	quotaEstimate: Type.Optional(number),
});
const Account = Type.Object({
	since: number, total: Summary, months: Type.Record(Type.String(), Summary),
	nonstandard: Type.Optional(Type.Boolean()),
	recent: Type.Array(Spend), current: Type.Optional(Period),
	closed: Type.Record(Type.String(), ClosedPeriod), previous: Type.Optional(Type.String()),
	unassignedUsd: number, missingWeeklyObservations: number, recordingGaps: number,
	lastObservation: Type.Optional(number), manualResetAt: Type.Optional(number),
	history: Type.Optional(Type.Object({ ...History.properties, importedAt: number, accountIdentity: Type.Literal("unverified") })),
});
const Ledger = Type.Object({ version: Type.Literal(1), accounts: Type.Record(Type.String(), Account), historyOwner: Type.Optional(Type.String()) });

export type SpendStats = Static<typeof Stats>;
export type SpendSummary = Static<typeof Summary>;
export type CodexSpend = Static<typeof Spend>;
export type UsagePeriod = Static<typeof Period>;
export type UsageAccount = Static<typeof Account>;
export type UsageLedger = Static<typeof Ledger>;
export type UsageHistoryScan = Static<typeof HistoryScan>;

export function parseUsageHistory(value: unknown): UsageHistoryScan {
	if (!Check(HistoryScan, value)) throw new Error("Invalid session history report; no history was imported.");
	return value;
}

export function parseUsageLedger(value: unknown): UsageLedger {
	if (!Check(Ledger, value)) throw new Error("Unsupported or invalid Codex usage ledger; the file was not changed.");
	return value;
}

export function emptyStats(): SpendStats {
	return { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, unpriced: 0 };
}

export function emptySummary(): SpendSummary { return { total: emptyStats(), models: {} }; }
