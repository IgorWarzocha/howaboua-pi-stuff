import type { DatabaseSync } from "node:sqlite";
import type { CacheBucket, CacheRequest, CacheSnapshot } from "./contracts.ts";
import type { IngestionCoverage } from "./ingestion.ts";
import type { RequestRecord } from "./requests.ts";

const SNAPSHOT_BYTES = 3.5 * 1024 * 1024;
const RECENT_LIMIT = 1500;

function newBucket(row: CacheRequest): CacheBucket {
	return {
		day: row.time.slice(0, 10),
		sessionId: row.sessionId,
		sessionName: row.sessionName,
		project: row.project,
		model: row.model,
		lane: row.lane,
		scope: row.scope,
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
	};
}

function addRecord(bucket: CacheBucket, record: RequestRecord): void {
	const row = record.row;
	bucket.records++;
	bucket.requestStarts += Number(record.requestSeen);
	bucket.measuredRequests += Number(row.measurement !== "unknown");
	bucket.hits += Number(row.measurement === "hit");
	bucket.misses += Number(row.measurement === "miss");
	bucket.unknownUsage += Number(row.measurement === "unknown");
	bucket.inputTokens += row.inputTokens ?? 0;
	bucket.cachedTokens += row.cachedTokens ?? 0;
	bucket.outputTokens += row.outputTokens ?? 0;
	bucket.retries += row.retries;
	bucket.fallbacks += row.fallbacks;
	bucket.failures += Number(
		row.status === "failed" || row.status === "aborted",
	);
	bucket.delta += Number(record.requestSeen && row.continuation === "delta");
	bucket.full += Number(
		record.requestSeen &&
			(row.transport === "sse" ||
				(row.continuation !== null && row.continuation !== "delta")),
	);
}

/** Full-dimensional buckets are retained only as whole UTC days, never individually dropped. */
export function project(
	db: DatabaseSync,
	ingestion: IngestionCoverage,
): CacheSnapshot {
	const range = db
		.prepare("SELECT min(day) AS first, max(day) AS last FROM records")
		.get();
	const last = typeof range?.["last"] === "string" ? range["last"] : null;
	const first = typeof range?.["first"] === "string" ? range["first"] : null;
	const cutoff = last
		? new Date(Date.parse(`${last}T00:00:00.000Z`) - 89 * 86400000)
				.toISOString()
				.slice(0, 10)
		: "";
	const grouped = new Map<string, CacheBucket>();
	const recent: CacheRequest[] = [];
	let count = 0;
	let legacyRecords = 0;
	for (const result of db
		.prepare("SELECT data FROM records WHERE day>=? ORDER BY time DESC, id")
		.iterate(cutoff)) {
		if (typeof result["data"] !== "string")
			throw new Error("Invalid collector record.");
		const record: RequestRecord = JSON.parse(result["data"]);
		const row = record.row;
		const key = JSON.stringify([
			row.time.slice(0, 10),
			row.sessionId,
			row.project,
			row.model,
			row.lane,
			row.scope,
		]);
		let bucket = grouped.get(key);
		if (!bucket) {
			bucket = newBucket(row);
			grouped.set(key, bucket);
		}
		addRecord(bucket, record);
		if (row.correlation === "legacy") legacyRecords++;
		if (recent.length < RECENT_LIMIT) recent.push(row);
		count++;
	}
	const buckets = [...grouped.values()].sort(
		(a, b) =>
			a.day.localeCompare(b.day) ||
			JSON.stringify(a).localeCompare(JSON.stringify(b)),
	);
	const snapshot: CacheSnapshot = {
		version: 1,
		coverage: {
			...ingestion,
			fromDay: buckets[0]?.day ?? null,
			toDay: last,
			historyTruncated: first !== null && first < cutoff,
			requestsTruncated: count > recent.length,
			legacyRecords,
		},
		buckets,
		requests: recent,
	};
	while (Buffer.byteLength(JSON.stringify(snapshot)) > SNAPSHOT_BYTES) {
		const oldest = snapshot.buckets[0]?.day;
		if (!oldest) throw new Error("Collector coverage exceeds snapshot limit.");
		snapshot.buckets = snapshot.buckets.filter(
			(bucket) => bucket.day !== oldest,
		);
		snapshot.coverage.historyTruncated = true;
		snapshot.coverage.fromDay = snapshot.buckets[0]?.day ?? null;
		snapshot.requests = snapshot.requests.filter(
			(row) => row.time.slice(0, 10) !== oldest,
		);
		snapshot.coverage.requestsTruncated = count > snapshot.requests.length;
	}
	// Counts describe retained aggregate coverage, not rows excluded by the recent-request cap.
	if (snapshot.coverage.fromDay !== (buckets[0]?.day ?? null)) {
		const lower = snapshot.coverage.fromDay;
		const result = lower
			? db
					.prepare(
						"SELECT count(*) AS count FROM records WHERE day>=? AND json_extract(data, '$.row.correlation')='legacy'",
					)
					.get(lower)
			: undefined;
		snapshot.coverage.legacyRecords = Number(result?.["count"] ?? 0);
	}
	return snapshot;
}
