import type { DatabaseSync } from "node:sqlite";
import type { CacheSnapshot } from "./contracts.ts";
import type { IngestionCoverage } from "./ingestion.ts";

/** Collection publishes availability; indexed history is served by read-only queries. */
export function project(
	db: DatabaseSync,
	ingestion: IngestionCoverage,
): CacheSnapshot {
	const revision = Number(
		db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.[
			"value"
		] ?? 0,
	);
	const saved = db
		.prepare("SELECT value FROM meta WHERE key='projection-v1'")
		.get();
	if (typeof saved?.["value"] === "string") {
		const cached: CacheSnapshot = JSON.parse(saved["value"]);
		if (cached.revision === revision)
			return { ...cached, coverage: { ...cached.coverage, ...ingestion } };
	}
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
	const snapshot: CacheSnapshot = {
		version: 2,
		revision,
		coverage: {
			...ingestion,
			fromDay: typeof range?.["first"] === "string" ? range["first"] : null,
			toDay: typeof range?.["last"] === "string" ? range["last"] : null,
			legacyRecords: Number(range?.["legacy"] ?? 0),
		},
		models: values("model"),
		scopes: values("scope"),
	};
	db.prepare(
		"INSERT INTO meta VALUES ('projection-v1', ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	).run(JSON.stringify(snapshot));
	return snapshot;
}
