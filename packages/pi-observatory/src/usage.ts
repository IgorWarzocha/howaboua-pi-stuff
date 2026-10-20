import type Database from "better-sqlite3";
import { hash, type JsonObject, object, string } from "./normalise.ts";

export function initialiseUsage(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS usage_events (
			key TEXT PRIMARY KEY, entry_key TEXT REFERENCES entries(key), call_id INTEGER REFERENCES calls(id),
			timestamp TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
			owner TEXT NOT NULL, input_source TEXT NOT NULL, evidence TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS usage_time ON usage_events(timestamp);
		CREATE INDEX IF NOT EXISTS usage_call ON usage_events(call_id);
		CREATE TABLE IF NOT EXISTS usage_snapshots (
			entry_key TEXT PRIMARY KEY REFERENCES entries(key), timestamp TEXT NOT NULL, kind TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS usage_inventory (
			entry_key TEXT NOT NULL REFERENCES usage_snapshots(entry_key),
			kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL, owner TEXT NOT NULL,
			PRIMARY KEY(entry_key,kind,name,path)
		);
	`);
}

const kinds = ["extension", "skill", "prompt"];
function resource(data: JsonObject) {
	const kind = string(data["source"]);
	const rawName = string(data["name"]);
	if (!kinds.includes(kind) || !rawName) return undefined;
	const info = object(data["sourceInfo"]);
	if (info["source"] === "builtin") return undefined;
	return {
		kind,
		name: kind === "skill" ? rawName.replace(/^skill:/, "") : rawName,
		path: string(info["path"]),
		owner: string(info["source"]),
	};
}

export function createUsageIngestor(db: Database.Database) {
	const event = db.prepare(`INSERT OR IGNORE INTO usage_events
		VALUES (@key,@entry,@call,@timestamp,@kind,@name,@path,@owner,@input,@evidence)`);
	const snapshot = db.prepare(
		"INSERT OR IGNORE INTO usage_snapshots VALUES (?,?,?)",
	);
	const inventory = db.prepare(`INSERT OR IGNORE INTO usage_inventory
		VALUES (@entry,@kind,@name,@path,@owner)`);
	const findOrigin = db.prepare<[number], { timestamp: string }>(
		"SELECT timestamp FROM calls WHERE id=?",
	);
	return {
		entry(record: JsonObject, key: string, timestamp: string): void {
			if (record["type"] !== "custom") return;
			const data = object(record["data"]);
			if (data["version"] !== 1) return;
			switch (record["customType"]) {
				case "pi-observatory:command_submission": {
					const item = resource(data);
					if (!item || data["inputSource"] !== "interactive") return;
					event.run({
						...item,
						key,
						entry: key,
						call: null,
						timestamp,
						input: "interactive",
						evidence: "submission",
					});
					break;
				}
				case "pi-observatory:recorder":
					if (data["inputSource"] === "interactive")
						snapshot.run(key, timestamp, "recording");
					break;
				case "pi-observatory:inventory":
					if (!Array.isArray(data["commands"])) return;
					snapshot.run(key, timestamp, "inventory");
					for (const command of data["commands"]) {
						const item = resource(object(command));
						if (item) inventory.run({ entry: key, ...item });
					}
			}
		},
		skillReads(call: number, result: JsonObject): void {
			const receipt = object(object(result["details"])["skillReads"]);
			if (
				result["isError"] === true ||
				receipt["version"] !== 1 ||
				!Array.isArray(receipt["reads"])
			)
				return;
			const origin = findOrigin.get(call);
			if (!origin) return;
			for (const raw of receipt["reads"]) {
				const read = object(raw);
				const name = string(read["name"]),
					path = string(read["skillPath"]),
					readPath = string(read["path"]);
				if (
					!name ||
					!path ||
					!readPath ||
					!["skill", "reference"].includes(string(read["kind"]))
				)
					continue;
				const evidence =
					receipt["continuation"] === true
						? "continuation"
						: read["kind"] === "skill"
							? "skill_read"
							: "reference_read";
				event.run({
					key: `read:${call}:${hash(readPath)}`,
					entry: null,
					call,
					timestamp: origin.timestamp,
					kind: "skill",
					name,
					path,
					owner: "",
					input: "agent",
					evidence,
				});
			}
		},
	};
}

export interface UsageRow {
	kind: string;
	name: string;
	path: string;
	owner: string;
	submissions: number;
	skillReads: number;
	referenceReads: number;
	continuations: number;
	lastUsed: string | null;
	lastSubmitted: string | null;
	firstAvailable: string | null;
	lastAvailable: string | null;
}
export interface UsageOverview {
	rows: UsageRow[];
	truncated: boolean;
	coverage: {
		recordingSince: string | null;
		inventorySince: string | null;
		recordedSessions: number;
		sessions: number;
	};
}

// These filters deliberately describe sessions and time, not model tool calls.
export function queryUsage(
	db: Database.Database,
	params: URLSearchParams,
): UsageOverview {
	const values = {
		session: params.get("session") ?? "",
		project: params.get("project") ?? "",
		since: params.get("since") ?? "",
		until: params.get("until") ?? "",
	};
	const files =
		"SELECT id FROM files WHERE (@session='' OR session_id=@session) AND (@project='' OR project=@project)";
	const entryMember = `entry_key IN (SELECT entry_key FROM file_entries WHERE file_id IN (${files}))`;
	const callMember = `call_id IN (SELECT call_id FROM file_calls WHERE file_id IN (${files}))`;
	const time =
		"(@since='' OR substr(timestamp,1,10)>=@since) AND (@until='' OR substr(timestamp,1,10)<=@until)";
	const rows = db
		.prepare<typeof values, UsageRow>(`
		WITH selected_events AS (SELECT * FROM usage_events WHERE kind IN ('extension','skill','prompt') AND owner<>'builtin' AND (${entryMember} OR ${callMember}) AND ${time}),
		available AS (SELECT i.*,s.timestamp FROM usage_inventory i JOIN usage_snapshots s USING(entry_key)
			WHERE i.kind IN ('extension','skill','prompt') AND owner<>'builtin' AND ${entryMember} AND (@until='' OR substr(timestamp,1,10)<=@until)),
		resources AS (SELECT kind,name,path,owner FROM selected_events UNION SELECT kind,name,path,owner FROM available),
		uses AS (SELECT kind,name,path,
			SUM(evidence='submission') submissions,
			SUM(evidence='skill_read') skillReads,SUM(evidence='reference_read') referenceReads,SUM(evidence='continuation') continuations,
			MAX(timestamp) lastUsed,MAX(CASE WHEN evidence='submission' THEN timestamp END) lastSubmitted FROM selected_events GROUP BY kind,name,path),
		seen AS (SELECT kind,name,path,MIN(timestamp) firstAvailable,MAX(timestamp) lastAvailable FROM available GROUP BY kind,name,path)
		SELECT r.kind,r.name,r.path,MAX(r.owner) owner,
			COALESCE(u.submissions,0) submissions,
			COALESCE(u.skillReads,0) skillReads,COALESCE(u.referenceReads,0) referenceReads,COALESCE(u.continuations,0) continuations,
			u.lastUsed,u.lastSubmitted,s.firstAvailable,s.lastAvailable FROM resources r
			LEFT JOIN uses u USING(kind,name,path) LEFT JOIN seen s USING(kind,name,path)
			GROUP BY r.kind,r.name,r.path ORDER BY (COALESCE(u.submissions,0)+COALESCE(u.skillReads,0)+COALESCE(u.referenceReads,0)) DESC,r.name LIMIT 501
	`)
		.all(values);
	const coverage = db
		.prepare<typeof values, UsageOverview["coverage"]>(`
		SELECT MIN(CASE WHEN kind='recording' THEN timestamp END) recordingSince,
			MIN(CASE WHEN kind='inventory' THEN timestamp END) inventorySince,
			(SELECT COUNT(DISTINCT session_id) FROM files WHERE id IN (${files}) AND id IN
				(SELECT file_id FROM file_entries WHERE entry_key IN (SELECT entry_key FROM usage_snapshots WHERE kind='recording'
					AND (@until='' OR substr(timestamp,1,10)<=@until)))) recordedSessions,
			(SELECT COUNT(DISTINCT session_id) FROM files WHERE id IN (${files})) sessions
		FROM usage_snapshots WHERE ${entryMember} AND (@until='' OR substr(timestamp,1,10)<=@until)
	`)
		.get(values);
	if (!coverage) throw new Error("Usage coverage is missing");
	return { rows: rows.slice(0, 500), truncated: rows.length > 500, coverage };
}
