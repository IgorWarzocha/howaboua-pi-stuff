import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type {
	CacheDay,
	CacheQuery,
	CacheQueryResult,
	CacheTotals,
} from "./contracts.ts";
import type { RequestRecord } from "./requests.ts";

const TEXT_FILTERS = [
	"session",
	"project",
	"since",
	"until",
	"model",
	"lane",
	"scope",
	"result",
] as const;

export function validateQuery(value: unknown): CacheQuery {
	if (!value || typeof value !== "object" || Array.isArray(value))
		throw new Error("Cache query must be an object.");
	const query: CacheQuery = {};
	for (const [key, field] of Object.entries(value)) {
		if (key === "offset") {
			if (
				typeof field !== "number" ||
				!Number.isSafeInteger(field) ||
				field < 0
			)
				throw new Error("offset must be a nonnegative safe integer.");
			query.offset = field;
			continue;
		}
		const filter = TEXT_FILTERS.find((name) => name === key);
		if (!filter) throw new Error(`Unknown cache query field: ${key}`);
		if (typeof field !== "string")
			throw new Error(`${filter} must be a string.`);
		if (filter === "result") {
			if (
				field !== "" &&
				field !== "hit" &&
				field !== "miss" &&
				field !== "unknown"
			)
				throw new Error("result must be hit, miss, unknown or empty.");
			query.result = field;
		} else {
			query[filter] = field;
		}
	}
	for (const key of ["since", "until"] as const) {
		const day = query[key];
		if (!day) continue;
		const time = Date.parse(`${day}T00:00:00.000Z`);
		if (
			!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
			!Number.isFinite(time) ||
			new Date(time).toISOString().slice(0, 10) !== day
		)
			throw new Error(`${key} must be a valid YYYY-MM-DD date.`);
	}
	if (query.since && query.until && query.since > query.until)
		throw new Error("since must not be after until.");
	return query;
}

const AGGREGATES = {
	records: "count(*)",
	requestStarts: "sum(json_extract(data, '$.requestSeen')=1)",
	measuredRequests: "sum(json_extract(data, '$.row.measurement')!='unknown')",
	hits: "sum(json_extract(data, '$.row.measurement')='hit')",
	misses: "sum(json_extract(data, '$.row.measurement')='miss')",
	unknownUsage: "sum(json_extract(data, '$.row.measurement')='unknown')",
	inputTokens: "sum(json_extract(data, '$.row.inputTokens'))",
	cachedTokens: "sum(json_extract(data, '$.row.cachedTokens'))",
	outputTokens: "sum(json_extract(data, '$.row.outputTokens'))",
	retries: "sum(json_extract(data, '$.row.retries'))",
	failures: "sum(json_extract(data, '$.row.status') IN ('failed', 'aborted'))",
	fallbacks: "sum(json_extract(data, '$.row.fallbacks'))",
	delta:
		"sum(json_extract(data, '$.requestSeen')=1 AND json_extract(data, '$.row.continuation')='delta')",
	full: `sum(json_extract(data, '$.requestSeen')=1 AND
		(json_extract(data, '$.row.transport')='sse' OR
		json_extract(data, '$.row.continuation')!='delta'))`,
	rebillMisses: "sum(json_extract(data, '$.row.rebill.tokens')>0)",
	rebillTokens: "sum(json_extract(data, '$.row.rebill.tokens'))",
	rebillCost: "sum(json_extract(data, '$.row.rebill.cost'))",
	unpricedRebillMisses:
		"sum(json_extract(data, '$.row.rebill.tokens')>0 AND json_extract(data, '$.row.rebill.cost') IS NULL)",
	unclassifiedMisses: "sum(json_extract(data, '$.rebillUnclassified')=1)",
} satisfies Record<keyof CacheTotals, string>;
const TOTAL_KEYS = Object.keys(AGGREGATES) as (keyof CacheTotals)[];
const SELECT_TOTALS = TOTAL_KEYS.map(
	(key) => `coalesce(${AGGREGATES[key]}, 0) AS ${key}`,
).join(", ");

function emptyTotals(): CacheTotals {
	return {
		records: 0,
		requestStarts: 0,
		measuredRequests: 0,
		hits: 0,
		misses: 0,
		unknownUsage: 0,
		inputTokens: 0,
		cachedTokens: 0,
		outputTokens: 0,
		retries: 0,
		failures: 0,
		fallbacks: 0,
		delta: 0,
		full: 0,
		rebillMisses: 0,
		rebillTokens: 0,
		rebillCost: 0,
		unpricedRebillMisses: 0,
		unclassifiedMisses: 0,
	};
}

/** Every section observes the same committed index, even while collection advances. */
export function queryRecords(
	db: DatabaseSync,
	query: CacheQuery,
): CacheQueryResult {
	const predicates: string[] = [];
	const parameters: SQLInputValue[] = [];
	for (const [key, field] of [
		["session", "sessionId"],
		["project", "project"],
		["model", "model"],
		["lane", "lane"],
		["scope", "scope"],
	] as const) {
		if (!query[key]) continue;
		predicates.push(`json_extract(data, '$.row.${field}')=?`);
		parameters.push(query[key]);
	}
	if (query.since) {
		predicates.push("day>=?");
		parameters.push(query.since);
	}
	if (query.until) {
		predicates.push("day<=?");
		parameters.push(query.until);
	}
	const where = predicates.length ? `WHERE ${predicates.join(" AND ")}` : "";
	db.exec("BEGIN");
	try {
		const totals = emptyTotals();
		const days: CacheDay[] = db
			.prepare(
				`SELECT day, ${SELECT_TOTALS} FROM records ${where} GROUP BY day ORDER BY day`,
			)
			.all(...parameters)
			.map((row) => {
				if (typeof row["day"] !== "string")
					throw new Error("Invalid indexed cache day.");
				const day: CacheDay = { day: row["day"], ...emptyTotals() };
				for (const key of TOTAL_KEYS) {
					const value = row[key];
					if (typeof value !== "number" || !Number.isFinite(value))
						throw new Error(`Invalid indexed cache total: ${key}`);
					day[key] = value;
					totals[key] += value;
				}
				return day;
			});
		// The result selector deliberately narrows only the table, not the metrics.
		if (query.result) {
			predicates.push("json_extract(data, '$.row.measurement')=?");
			parameters.push(query.result);
		}
		const tableWhere = predicates.length
			? `WHERE ${predicates.join(" AND ")}`
			: "";
		const total = Number(
			db
				.prepare(`SELECT count(*) AS total FROM records ${tableWhere}`)
				.get(...parameters)?.["total"] ?? 0,
		);
		const offset = query.offset ?? 0;
		const requests = db
			.prepare(
				`SELECT data FROM records ${tableWhere} ORDER BY time DESC, id LIMIT 50 OFFSET ?`,
			)
			.all(...parameters, offset)
			.map((row) => {
				if (typeof row["data"] !== "string")
					throw new Error("Invalid indexed cache record.");
				const record: RequestRecord = JSON.parse(row["data"]);
				return record.row;
			});
		db.exec("COMMIT");
		return { version: 1, totals, days, requests, total, offset, limit: 50 };
	} catch (error) {
		db.exec("ROLLBACK");
		throw error;
	}
}
