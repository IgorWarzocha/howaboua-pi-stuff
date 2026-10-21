import type Database from "better-sqlite3";
import { createCallStore, type Source, type StoredCall } from "./calls.ts";
import { hash, type JsonObject, object, string } from "./normalise.ts";

export function initialiseToolObservations(db: Database.Database): void {
	db.exec(`CREATE TABLE IF NOT EXISTS tool_observations (
		key TEXT PRIMARY KEY, session_id TEXT NOT NULL, entry_id TEXT NOT NULL,
		root_id TEXT NOT NULL, call_id TEXT NOT NULL, parent_id TEXT, timestamp TEXT NOT NULL,
		entry_key TEXT NOT NULL REFERENCES entries(key), file_id INTEGER NOT NULL REFERENCES files(id),
		line INTEGER NOT NULL, data TEXT NOT NULL, linked_call INTEGER REFERENCES calls(id), issue TEXT
	);
	CREATE INDEX IF NOT EXISTS observation_call ON tool_observations(linked_call);
	CREATE INDEX IF NOT EXISTS observation_pending ON tool_observations(key) WHERE linked_call IS NULL;`);
}

export function createObservationIngestor(db: Database.Database) {
	const put = db.prepare(`INSERT INTO tool_observations
		(key,session_id,entry_id,root_id,call_id,parent_id,timestamp,entry_key,file_id,line,data)
		VALUES (@key,@session,@entry,@root,@call,@parent,@timestamp,@entryKey,@file,@line,@data)
		ON CONFLICT(key) DO UPDATE SET timestamp=excluded.timestamp,entry_key=excluded.entry_key,
		file_id=excluded.file_id,line=excluded.line,data=excluded.data,linked_call=NULL,issue=NULL
		WHERE excluded.timestamp>=tool_observations.timestamp`);
	return (
		record: JsonObject,
		entryKey: string,
		source: Source,
		line: number,
		timestamp: string,
	): void => {
		if (
			record["type"] !== "custom" ||
			record["customType"] !== "pi-observatory:tool"
		)
			return;
		const data = object(record["data"]);
		const session = string(data["sessionId"]),
			entry = string(data["entryId"]),
			root = string(data["rootId"]),
			call = string(data["callId"]);
		if (
			data["version"] !== 1 ||
			!session ||
			!entry ||
			!root ||
			!call ||
			!string(data["name"])
		)
			return;
		put.run({
			key: hash(JSON.stringify([session, entry, call])),
			session,
			entry,
			root,
			call,
			parent: string(data["parentId"]) || null,
			timestamp,
			entryKey,
			file: source.id,
			line,
			data: JSON.stringify(data),
		});
	};
}

interface Observation {
	key: string;
	entry_key: string;
	file_id: number;
	line: number;
	call_id: string;
	parent_id: string | null;
	data: string;
	root: number;
}
interface Parent extends StoredCall {
	file_id: number;
	tool: string;
	result: string;
	arguments: string;
}

/** Reconcile after session ingestion and cached native receipts, independent of file order. */
export function createObservedToolBackfill(db: Database.Database) {
	const store = createCallStore(db);
	const candidates = db.prepare<[string], Observation>(`
		SELECT o.*,c.id root FROM tool_observations o
		JOIN files f ON f.session_id=o.session_id
		JOIN file_entries e ON e.file_id=f.id AND e.entry_id=o.entry_id
		JOIN calls c ON c.initiator=e.entry_key AND c.call_id=o.root_id
		WHERE o.linked_call IS NULL AND o.key>? AND (o.parent_id IS NULL OR c.result_entry IS NOT NULL)
		GROUP BY o.key ORDER BY o.key LIMIT 64
	`);
	const parent = db.prepare<[number], Parent>(
		"SELECT c.*,p.result,p.arguments FROM calls c JOIN payloads p ON p.call_id=c.id WHERE c.id=?",
	);
	const cell = db.prepare<[number, string], { origin: number }>(
		"SELECT origin FROM cells WHERE file_id=? AND cell_id=?",
	);
	const mapped = db.prepare<[string], { id: number }>(
		"SELECT call_id id FROM native_links WHERE key=?",
	);
	const link = db.prepare(
		"UPDATE tool_observations SET linked_call=?,issue=NULL WHERE key=?",
	);
	const issue = db.prepare(
		"UPDATE tool_observations SET issue=? WHERE key=? AND issue IS NOT ?",
	);
	const argumentsUpdate = db.prepare(
		"UPDATE payloads SET arguments=? WHERE call_id=?",
	);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	let cursor = "";
	return db.transaction((): boolean => {
		const batch = candidates.all(cursor);
		let changed = false;
		for (const row of batch) {
			cursor = row.key;
			const data = object(JSON.parse(row.data));
			let root = parent.get(row.root);
			if (!root) continue;
			if (!row.parent_id) {
				link.run(root.id, row.key);
				changed = true;
				continue;
			}
			let result: JsonObject;
			try {
				result = object(JSON.parse(root.result));
			} catch {
				continue;
			}
			const details = object(result["details"]);
			const cellId = string(details["cellId"]);
			if (cellId) {
				const origin = cell.get(root.file_id, cellId)?.origin;
				if (origin) root = parent.get(origin) ?? root;
			}
			const key = `native:${hash(`${root.key}:${row.call_id}`)}`;
			const target = mapped.get(key);
			if (target) {
				link.run(target.id, row.key);
				changed = true;
				continue;
			}
			const traces = Array.isArray(details["traces"]) ? details["traces"] : [];
			if (
				(Array.isArray(details["traces"]) &&
					(traces.length === 0 ||
						traces.some((value) => {
							const trace = object(value);
							return (
								!Array.isArray(trace["nativeCallIds"]) ||
								["running", "blocked"].includes(string(trace["status"]))
							);
						}))) ||
				Number(details["droppedTraceCount"]) > 0
			) {
				const message =
					"Live native result retained; no exact trace correlation is available yet.";
				changed = issue.run(message, row.key, message).changes > 0 || changed;
				continue;
			}
			const args = string(data["arguments"], "[Arguments not recorded]");
			const call = store.insertCall(
				{
					key,
					callId: row.call_id,
					initiator: null,
					file: row.file_id,
					line: row.line,
					timestamp: root.timestamp,
					provider: root.provider,
					model: root.model,
					tool: string(data["name"]),
					scope: "nested",
					project: root.project,
					parent: root.id,
					unpaired: 0,
				},
				null,
			);
			argumentsUpdate.run(args || "[Arguments not recorded]", call.id);
			const raw = string(data["result"]);
			if (raw) {
				let observed: JsonObject;
				try {
					observed = object(JSON.parse(raw));
				} catch {
					observed = {
						content: [{ type: "text", text: raw }],
						note: "Live result truncated",
					};
				}
				store.recordResult(
					call,
					{
						...observed,
						toolName: string(data["name"]),
						isError: data["isError"],
					},
					{
						entry: row.entry_key,
						file: row.file_id,
						line: row.line,
						missing: 0,
						dropped: 0,
						observed: true,
					},
				);
			}
			link.run(call.id, row.key);
			changed = true;
		}
		if (changed) revision.run();
		if (batch.length < 64) cursor = "";
		return batch.length === 64;
	});
}
