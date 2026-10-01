// These internal JSON shapes also run in standalone Node, outside Pi's peer aliases.
type Check<T> = (value: unknown) => value is T;
type Static<T> = T extends Check<infer Value> ? Value : never;
type Fields = Record<string, Check<unknown>>;
type ObjectValue<Shape extends Fields> = {
	[Key in keyof Shape as undefined extends Static<Shape[Key]> ? never : Key]: Static<Shape[Key]>;
} & {
	[Key in keyof Shape as undefined extends Static<Shape[Key]> ? Key : never]?: Static<Shape[Key]>;
};

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const string = (value: unknown): value is string => typeof value === "string";
const boolean = (value: unknown): value is boolean => typeof value === "boolean";

function object<Shape extends Fields>(shape: Shape): Check<ObjectValue<Shape>> {
	const fields = Object.entries(shape);
	return (value): value is ObjectValue<Shape> => isObject(value) && fields.every(([key, check]) => check(value[key]));
}

function record<Value>(check: Check<Value>): Check<Record<string, Value>> {
	return (value): value is Record<string, Value> => isObject(value) && Object.values(value).every(check);
}

function array<Value>(check: Check<Value>): Check<Value[]> {
	return (value): value is Value[] => Array.isArray(value) && value.every(check);
}

function optional<Value>(check: Check<Value>): Check<Value | undefined> {
	return (value): value is Value | undefined => value === undefined || check(value);
}

function literal<const Value extends string | number>(...values: Value[]): Check<Value> {
	return (value): value is Value => values.some((expected) => value === expected);
}

const Stats = object({
	usd: number, input: number, output: number, cacheRead: number, cacheWrite: number,
	requests: number, unpriced: number,
});
const Summary = object({ total: Stats, models: record(Stats) });
const Spend = object({ at: number, model: string, stats: Stats });
const Quota = object({ at: number, usedPercent: (value: unknown): value is number => number(value) && value <= 100, usd: number });
const HistoryCoverage = object({ sessions: number, skippedCopies: number, incompleteEntries: number, unattributedUsage: number, unreadablePaths: optional(number), warnings: array(string) });
const HistoryFields = {
	from: number, to: number, windowStart: number, root: string, coverage: HistoryCoverage,
};
const HistoryScan = object({
	...HistoryFields, total: Summary, months: record(Summary), previous: Summary, recent: array(Spend),
	nonstandard: optional(boolean),
});
const PeriodFields = {
	start: number, expectedReset: number,
	source: literal("inferred", "manual", "session-history"),
	partial: boolean, summary: Summary,
	approximate: optional(boolean),
	quota: optional(Quota), quotaPerUsd: optional(number),
};
const Period = object(PeriodFields);
const ClosedPeriod = object({
	...PeriodFields,
	end: number, closedAt: number,
	reason: literal("scheduled", "early", "gap", "backfill"),
	quotaEstimate: optional(number),
});
const Account = object({
	since: number, total: Summary, months: record(Summary),
	nonstandard: optional(boolean),
	recent: array(Spend), current: optional(Period),
	closed: record(ClosedPeriod), previous: optional(string),
	unassignedUsd: number, missingWeeklyObservations: number, recordingGaps: number,
	lastObservation: optional(number), manualResetAt: optional(number),
	history: optional(object({ ...HistoryFields, importedAt: number, accountIdentity: literal("unverified") })),
});
const Ledger = object({ version: literal(1), accounts: record(Account), historyOwner: optional(string) });

export type SpendStats = Static<typeof Stats>;
export type SpendSummary = Static<typeof Summary>;
export type CodexSpend = Static<typeof Spend>;
export type UsagePeriod = Static<typeof Period>;
export type UsageAccount = Static<typeof Account>;
export type UsageLedger = Static<typeof Ledger>;
export type UsageHistoryScan = Static<typeof HistoryScan>;

export function parseUsageHistory(value: unknown): UsageHistoryScan {
	if (!HistoryScan(value)) throw new Error("Invalid session history report; no history was imported.");
	return value;
}

export function parseUsageLedger(value: unknown): UsageLedger {
	if (!Ledger(value)) throw new Error("Unsupported or invalid Codex usage ledger; the file was not changed.");
	return value;
}

export function emptyStats(): SpendStats {
	return { usd: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, requests: 0, unpriced: 0 };
}

export function emptySummary(): SpendSummary { return { total: emptyStats(), models: {} }; }
