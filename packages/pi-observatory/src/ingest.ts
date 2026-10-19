import type Database from "better-sqlite3";
import {
	assess,
	displayValue,
	hash,
	type JsonObject,
	object,
	string,
	textContent,
	timestamp,
} from "./normalise.ts";

interface Source {
	id: number;
	project: string;
}
interface StoredCall {
	id: number;
	key: string;
	provider: string;
	model: string;
	timestamp: string;
	project: string;
	outcome: string;
	result_entry: string | null;
}

export function createIngestor(db: Database.Database) {
	const putEntry = db.prepare(
		"INSERT OR IGNORE INTO entries VALUES (@key,@timestamp,@role,@text)",
	);
	const linkEntry = db.prepare(
		"INSERT INTO file_entries VALUES (@file,@line,@id,@parent,@key)",
	);
	const header = db.prepare(
		"UPDATE files SET session_id=?,project=? WHERE id=?",
	);
	const putCall = db.prepare(`INSERT OR IGNORE INTO calls
		(key,call_id,initiator,file_id,line,timestamp,provider,model,tool,scope,outcome,project,parent_call_id,unpaired)
		VALUES (@key,@callId,@initiator,@file,@line,@timestamp,@provider,@model,@tool,@scope,'pending',@project,@parent,@unpaired)`);
	const findCall = db.prepare<[string], StoredCall>(
		"SELECT * FROM calls WHERE key=?",
	);
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
	const putPayload = db.prepare(
		"INSERT OR IGNORE INTO payloads(call_id,arguments) VALUES (?,?)",
	);
	const setResult =
		db.prepare(`UPDATE calls SET outcome=@outcome,exit_code=@exitCode,signature=@signature,preview=@preview,
		result_entry=@entry,file_id=@file,line=@line,missing_traces=@missing,dropped_traces=@dropped WHERE id=@id`);
	const resultPayload = db.prepare(
		"UPDATE payloads SET result=? WHERE call_id=?",
	);
	const putCell = db.prepare(
		"INSERT INTO cells VALUES (?,?,?) ON CONFLICT(file_id,cell_id) DO UPDATE SET origin=excluded.origin",
	);
	const findCell = db.prepare<[number, string], StoredCall>(
		"SELECT c.* FROM cells s JOIN calls c ON c.id=s.origin WHERE s.file_id=? AND s.cell_id=?",
	);
	const linkCall = db.prepare("INSERT OR IGNORE INTO file_calls VALUES (?,?)");
	const linkChildren = db.prepare(
		"INSERT OR IGNORE INTO file_calls SELECT ?,id FROM calls WHERE parent_call_id=?",
	);
	const inheritFiles = db.prepare(
		"INSERT OR IGNORE INTO file_calls SELECT file_id,? FROM file_calls WHERE call_id=?",
	);

	function insertCall(
		params: {
			key: string;
			callId: string;
			initiator: string | null;
			file: number;
			line: number;
			timestamp: string;
			provider: string;
			model: string;
			tool: string;
			scope: string;
			project: string;
			parent: number | null;
			unpaired: number;
		},
		args: unknown,
	): StoredCall {
		putCall.run(params);
		const stored = findCall.get(params.key);
		if (!stored) throw new Error("Indexed call was not persisted");
		putPayload.run(stored.id, displayValue(args));
		linkCall.run(params.file, stored.id);
		if (params.parent !== null) inheritFiles.run(stored.id, params.parent);
		else linkChildren.run(params.file, stored.id);
		return stored;
	}

	function recordResult(
		call: StoredCall,
		result: JsonObject,
		context: {
			entry: string;
			file: number;
			line: number;
			missing: number;
			dropped: number;
		},
		traceStatus?: string,
	): void {
		linkCall.run(context.file, call.id);
		// Yield/wait snapshots and copied fork history must not turn a terminal call back into a pending call.
		if (call.result_entry !== null && call.outcome !== "pending") return;
		setResult.run({ ...assess(result, traceStatus), ...context, id: call.id });
		resultPayload.run(displayValue(result), call.id);
	}

	function nested(
		source: Source,
		line: number,
		key: string,
		message: JsonObject,
		outer: StoredCall,
		tool: string,
	): void {
		const details = object(message["details"]);
		const cell = string(details["cellId"]);
		if (cell && tool === "exec") putCell.run(source.id, cell, outer.id);
		const origin = cell ? findCell.get(source.id, cell) : undefined;
		const traces = Array.isArray(details["traces"]) ? details["traces"] : [];
		for (const [index, value] of traces.entries()) {
			const trace = object(value);
			const name = string(trace["name"]);
			if (!name) continue;
			const traceId = string(trace["id"]);
			// Modern trace IDs include a runtime UUID. Older IDs are scoped to the originating cell.
			const identity =
				origin?.key ??
				(/^[0-9a-f]{8}-[0-9a-f-]{27,}:/i.test(traceId) ? "runtime" : key);
			const call = insertCall(
				{
					key: `nested:${hash(`${identity}:${traceId || index}`)}`,
					callId: traceId || `trace-${index}`,
					initiator: null,
					file: source.id,
					line,
					timestamp: origin?.timestamp ?? outer.timestamp,
					provider:
						origin?.provider ?? (tool === "exec" ? outer.provider : "unknown"),
					model: origin?.model ?? (tool === "exec" ? outer.model : "unknown"),
					tool: name,
					scope: "nested",
					project: source.project,
					parent: origin?.id ?? outer.id,
					unpaired: origin || tool === "exec" ? 0 : 1,
				},
				trace["input"],
			);
			recordResult(
				call,
				{
					...object(trace["result"]),
					...(trace["error"] ? { error: trace["error"] } : {}),
				},
				{ entry: key, file: source.id, line, missing: 0, dropped: 0 },
				string(trace["status"]),
			);
		}
	}

	return function ingest(
		source: Source,
		line: number,
		record: JsonObject,
	): void {
		if (record["type"] === "session") {
			source.project = string(record["cwd"], "unknown");
			header.run(string(record["id"], "unknown"), source.project, source.id);
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
			text: textContent(message["content"]).slice(0, 32768),
		});
		linkEntry.run({
			file: source.id,
			line,
			id: string(record["id"], `line-${line}`),
			parent: string(record["parentId"]) || null,
			key,
		});
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
					["exec", "wait"].includes(tool) && !Array.isArray(details["traces"])
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
