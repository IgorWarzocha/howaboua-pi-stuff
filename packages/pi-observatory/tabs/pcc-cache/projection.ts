import type { DatabaseSync } from "node:sqlite";
import type { CacheSnapshot } from "./contracts.ts";
import type { IngestionCoverage } from "./ingestion.ts";

/** Collection publishes availability; indexed history is served by read-only queries. */
export function project(
	db: DatabaseSync,
	ingestion: IngestionCoverage,
): CacheSnapshot {
	const range = db
		.prepare(`SELECT min(day) AS first, max(day) AS last,
		coalesce(sum(json_extract(data, '$.row.correlation')='legacy'), 0) AS legacy
		FROM records`)
		.get();
	const facets = db
		.prepare(`SELECT DISTINCT json_extract(data, '$.row.model') AS model,
		json_extract(data, '$.row.scope') AS scope FROM records`)
		.all();
	const values = (key: string) =>
		[
			...new Set(
				facets.map((row) => {
					const value = row[key];
					if (typeof value !== "string")
						throw new Error(`Invalid indexed cache ${key}.`);
					return value;
				}),
			),
		].sort();
	return {
		version: 2,
		coverage: {
			...ingestion,
			fromDay: typeof range?.["first"] === "string" ? range["first"] : null,
			toDay: typeof range?.["last"] === "string" ? range["last"] : null,
			legacyRecords: Number(range?.["legacy"] ?? 0),
		},
		models: values("model"),
		scopes: values("scope"),
	};
}
