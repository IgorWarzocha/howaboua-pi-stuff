import type Database from "better-sqlite3";
import { hash, type JsonObject, object, string } from "./normalise.ts";
import {
	applySkillRootPolicy,
	createSkillFileIngestor,
} from "./skill-files.ts";

export function initialiseUsage(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS usage_events (
			key TEXT PRIMARY KEY, entry_key TEXT REFERENCES entry_refs(key), call_id INTEGER REFERENCES calls(id),
			timestamp TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, path TEXT NOT NULL,
			owner TEXT NOT NULL, input_source TEXT NOT NULL, evidence TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS usage_time ON usage_events(timestamp);
		CREATE INDEX IF NOT EXISTS usage_call ON usage_events(call_id);
		CREATE TABLE IF NOT EXISTS usage_snapshots (
			entry_key TEXT PRIMARY KEY REFERENCES entry_refs(key), timestamp TEXT NOT NULL, kind TEXT NOT NULL
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
	applySkillRootPolicy(db);
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
							if (item.kind === "skill")
								files.register(item.path, item.name, true);
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
				files.register(path, name, true);
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
