import type Database from "better-sqlite3";
import { hash, type JsonObject, object, string } from "./normalise.ts";
import { createSkillFileIngestor } from "./skill-files.ts";

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
		CREATE TABLE IF NOT EXISTS skill_file_sources (
			path TEXT PRIMARY KEY, directory TEXT NOT NULL, name TEXT NOT NULL, authoritative INTEGER NOT NULL
		);
		CREATE TABLE IF NOT EXISTS skill_file_gaps (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id), reason TEXT NOT NULL
		);
		CREATE TABLE IF NOT EXISTS skill_file_candidates (
			call_id INTEGER NOT NULL REFERENCES calls(id), path TEXT NOT NULL,
			PRIMARY KEY(call_id,path)
		);
		CREATE INDEX IF NOT EXISTS skill_candidate_path ON skill_file_candidates(path,call_id);
		CREATE TABLE IF NOT EXISTS skill_file_replay (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id)
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
	const files = createSkillFileIngestor(db);
	const event = db.prepare(`INSERT OR IGNORE INTO usage_events
		VALUES (@key,@entry,@call,@timestamp,@kind,@name,@path,@owner,@input,@evidence)
		ON CONFLICT(key) DO UPDATE SET name=excluded.name,path=excluded.path,evidence=excluded.evidence
		WHERE usage_events.evidence IN ('file_read','file_reference_read')`);
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
						if (item) {
							inventory.run({ entry: key, ...item });
							if (item.kind === "skill") files.register(item.path, item.name);
						}
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
				files.register(path, name);
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
		fileReads: files.record,
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
	fileReads: number;
	fileReferenceReads: number;
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
		fileReadScan: { phase: string; progress: number; unresolved: number };
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
	const fileScope =
		"(@session='' OR f.session_id=@session) AND (@project='' OR f.project=@project)";
	const scoped = Boolean(values.session || values.project);
	// Probe membership from the small observation set. Materialising the entire
	// session-history key set makes an all-sessions usage query scale with every message.
	const entryMember = (key: string) =>
		scoped
			? `EXISTS (SELECT 1 FROM file_entries fe JOIN files f ON f.id=fe.file_id WHERE fe.entry_key=${key} AND ${fileScope})`
			: "1";
	const callMember = scoped
		? `EXISTS (SELECT 1 FROM file_calls fc JOIN files f ON f.id=fc.file_id WHERE fc.call_id=e.call_id AND ${fileScope})`
		: "1";
	const time =
		"(@since='' OR substr(timestamp,1,10)>=@since) AND (@until='' OR substr(timestamp,1,10)<=@until)";
	const rows = db
		.prepare<typeof values, UsageRow>(`
		WITH selected_events AS (SELECT * FROM usage_events e WHERE kind IN ('extension','skill','prompt') AND owner<>'builtin' AND (${entryMember("e.entry_key")} OR ${callMember}) AND ${time}),
		available AS (SELECT i.*,s.timestamp FROM usage_inventory i JOIN usage_snapshots s USING(entry_key)
			WHERE i.kind IN ('extension','skill','prompt') AND owner<>'builtin' AND ${entryMember("i.entry_key")} AND (@until='' OR substr(timestamp,1,10)<=@until)),
		resources AS (SELECT kind,name,path,owner FROM selected_events UNION SELECT kind,name,path,owner FROM available),
		uses AS (SELECT kind,name,path,
			SUM(evidence='submission') submissions,
			SUM(evidence='skill_read') skillReads,SUM(evidence='reference_read') referenceReads,SUM(evidence='continuation') continuations,
			SUM(evidence='file_read') fileReads,SUM(evidence='file_reference_read') fileReferenceReads,
			MAX(timestamp) lastUsed,MAX(CASE WHEN evidence='submission' THEN timestamp END) lastSubmitted FROM selected_events GROUP BY kind,name,path),
		seen AS (SELECT kind,name,path,MIN(timestamp) firstAvailable,MAX(timestamp) lastAvailable FROM available GROUP BY kind,name,path)
		SELECT r.kind,r.name,r.path,MAX(r.owner) owner,
			COALESCE(u.submissions,0) submissions,
			COALESCE(u.skillReads,0) skillReads,COALESCE(u.referenceReads,0) referenceReads,COALESCE(u.continuations,0) continuations,
			COALESCE(u.fileReads,0) fileReads,COALESCE(u.fileReferenceReads,0) fileReferenceReads,
			u.lastUsed,u.lastSubmitted,s.firstAvailable,s.lastAvailable FROM resources r
			LEFT JOIN uses u USING(kind,name,path) LEFT JOIN seen s USING(kind,name,path)
			GROUP BY r.kind,r.name,r.path ORDER BY (COALESCE(u.submissions,0)+COALESCE(u.skillReads,0)+COALESCE(u.referenceReads,0)+COALESCE(u.fileReads,0)+COALESCE(u.fileReferenceReads,0)) DESC,r.name LIMIT 501
	`)
		.all(values);
	const coverage = db
		.prepare<typeof values, Omit<UsageOverview["coverage"], "fileReadScan">>(`
		SELECT MIN(CASE WHEN kind='recording' THEN timestamp END) recordingSince,
			MIN(CASE WHEN kind='inventory' THEN timestamp END) inventorySince,
			(SELECT COUNT(DISTINCT f.session_id) FROM usage_snapshots rs
				JOIN file_entries fe ON fe.entry_key=rs.entry_key JOIN files f ON f.id=fe.file_id
				WHERE rs.kind='recording' AND ${fileScope} AND (@until='' OR substr(rs.timestamp,1,10)<=@until)) recordedSessions,
			(SELECT COUNT(DISTINCT f.session_id) FROM files f WHERE ${fileScope}) sessions
		FROM usage_snapshots s WHERE ${entryMember("s.entry_key")} AND (@until='' OR substr(timestamp,1,10)<=@until)
	`)
		.get(values);
	if (!coverage) throw new Error("Usage coverage is missing");
	const scan = Object.fromEntries(
		db
			.prepare<[], { key: string; value: string }>(
				"SELECT key,value FROM metadata WHERE key LIKE 'fileReadBackfill%'",
			)
			.all()
			.map(({ key, value }) => [key, value]),
	);
	const phase = scan["fileReadBackfillPhase"] || "pending";
	const target = Number(scan["fileReadBackfillTarget"] || 0);
	const cursor = Number(scan["fileReadBackfillCursor"] || 0);
	const unresolved =
		db
			.prepare<[], { count: number }>(
				"SELECT COUNT(*) count FROM skill_file_gaps",
			)
			.get()?.count || 0;
	return {
		rows: rows.slice(0, 500),
		truncated: rows.length > 500,
		coverage: {
			...coverage,
			fileReadScan: {
				phase,
				progress:
					phase === "complete"
						? 100
						: target
							? Math.min(99, Math.floor((cursor / target) * 100))
							: 0,
				unresolved,
			},
		},
	};
}
