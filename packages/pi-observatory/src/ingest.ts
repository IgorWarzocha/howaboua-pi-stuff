import type Database from "better-sqlite3";
import { createCallStore, type Source, type StoredCall } from "./calls.ts";
import { createNestedIngestor } from "./nested.ts";
import {
	hash,
	type JsonObject,
	object,
	string,
	timestamp,
} from "./normalise.ts";
import { createProvenance } from "./provenance.ts";
import { sourceRecipe } from "./source-records.ts";
import { createObservationIngestor } from "./tool-observations.ts";
import { createUsageIngestor } from "./usage.ts";

export function createIngestor(db: Database.Database) {
	const putEntry = db.prepare(
		"INSERT OR IGNORE INTO entry_refs VALUES (@key,@timestamp,@role,@text)",
	);
	const linkEntry = db.prepare(
		"INSERT INTO file_entries VALUES (@file,@line,@id,@parent,@key)",
	);
	const provenance = createProvenance(db);
	const replayOwnership =
		db.prepare(`INSERT OR IGNORE INTO source_ownership_replay
		SELECT ? WHERE EXISTS (SELECT 1 FROM file_entries WHERE entry_key=? AND file_id<>?)`);
	const { insertCall, recordResult } = createCallStore(db);
	const nested = createNestedIngestor(db);
	const usage = createUsageIngestor(db);
	const observation = createObservationIngestor(db);
	const pair = db.prepare<[number, string, string, string], StoredCall>(`
		WITH RECURSIVE ancestors AS (
			SELECT file_id,entry_key,parent_id,0 depth FROM file_entries WHERE file_id=? AND entry_id=?
			UNION ALL
			SELECT e.file_id,e.entry_key,e.parent_id,a.depth+1 FROM file_entries e JOIN ancestors a
			ON e.file_id=a.file_id AND e.entry_id=a.parent_id
			WHERE a.depth<10000 AND NOT EXISTS (SELECT 1 FROM calls c WHERE c.initiator=a.entry_key AND c.call_id=?)
		)
		SELECT c.* FROM ancestors a JOIN calls c ON c.initiator=a.entry_key WHERE c.call_id=? LIMIT 1
	`);
	return function ingest(
		source: Source,
		line: number,
		record: JsonObject,
	): void {
		if (line === 1 || record["type"] === "session")
			provenance.recordHeader(source.id, record);
		if (record["type"] === "session") {
			source.project = string(record["cwd"], "unknown");
			return;
		}
		const message = object(record["message"]);
		const role = string(message["role"], string(record["type"], "unknown"));
		const at = timestamp(record["timestamp"] ?? message["timestamp"]);
		// Branch exports can change parentId while preserving the original event and tool-call IDs.
		const key = hash(JSON.stringify({ ...record, parentId: undefined }));
		putEntry.run({
			key,
			timestamp: at,
			role,
			text: sourceRecipe(db, record, "context"),
		});
		linkEntry.run({
			file: source.id,
			line,
			id: string(record["id"], `line-${line}`),
			parent: string(record["parentId"]) || null,
			key,
		});
		replayOwnership.run(key, key, source.id);
		usage.entry(record, key, at);
		observation(record, key, source, line, at);
		if (record["type"] !== "message") return;
		if (role === "assistant" && Array.isArray(message["content"])) {
			for (const [index, value] of message["content"].entries()) {
				const part = object(value);
				if (part["type"] !== "toolCall") continue;
				const callId = string(part["id"], `missing-${index}`);
				insertCall(
					{
						key: `direct:${key}:${callId}`,
						callId,
						initiator: key,
						file: source.id,
						line,
						timestamp: at,
						provider: string(message["provider"], "unknown"),
						model: string(message["model"], "unknown"),
						tool: string(part["name"], "unknown"),
						scope: "direct",
						project: source.project,
						parent: null,
						unpaired: 0,
					},
					part["arguments"],
				);
			}
		} else if (role === "toolResult") {
			const callId = string(message["toolCallId"]);
			const tool = string(message["toolName"], "unknown");
			const call =
				pair.get(source.id, string(record["parentId"]), callId, callId) ??
				insertCall(
					{
						key: `unpaired:${key}`,
						callId,
						initiator: null,
						file: source.id,
						line,
						timestamp: at,
						provider: "unknown",
						model: "unknown",
						tool,
						scope: "direct",
						project: source.project,
						parent: null,
						unpaired: 1,
					},
					"[No matching initiating call in the indexed ancestry]",
				);
			const details = object(message["details"]);
			const dropped = details["droppedTraceCount"];
			recordResult(call, message, {
				entry: key,
				file: source.id,
				line,
				missing:
					["exec", "wait"].includes(tool) &&
					!Array.isArray(details["traces"]) &&
					!Array.isArray(object(message["nestedCalls"])["calls"])
						? 1
						: 0,
				dropped:
					typeof dropped === "number" &&
					Number.isSafeInteger(dropped) &&
					dropped > 0
						? dropped
						: 0,
			});
			nested(source, line, key, message, call, tool);
		}
	};
}
