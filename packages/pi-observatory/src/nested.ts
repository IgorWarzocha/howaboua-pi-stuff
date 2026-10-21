import type Database from "better-sqlite3";
import { createCallStore, type Source, type StoredCall } from "./calls.ts";
import { hash, type JsonObject, object, string } from "./normalise.ts";

/** Shared by live indexing and the resumable cached-result migration. */
export function createNestedIngestor(db: Database.Database) {
	const { insertCall, recordResult } = createCallStore(db);
	const putCell = db.prepare(
		"INSERT INTO cells VALUES (?,?,?) ON CONFLICT(file_id,cell_id) DO UPDATE SET origin=excluded.origin",
	);
	const findCell = db.prepare<[number, string], StoredCall>(
		"SELECT c.* FROM cells s JOIN calls c ON c.id=s.origin WHERE s.file_id=? AND s.cell_id=?",
	);
	const linkNative = db.prepare(
		"INSERT OR IGNORE INTO native_links VALUES (?,?)",
	);
	const findNative = db.prepare("SELECT 1 FROM native_links WHERE key=?");
	const nativeRecorded = db.prepare(
		"UPDATE calls SET missing_traces=0 WHERE id=? AND missing_traces<>0",
	);
	const putReceipt =
		db.prepare(`INSERT INTO native_receipts VALUES (@call,@status,@missing,@duration)
		ON CONFLICT(call_id) DO UPDATE SET status=excluded.status,arguments_missing=excluded.arguments_missing,duration_ms=excluded.duration_ms`);
	const putCoverage = db.prepare(`INSERT INTO nested_coverage VALUES (?,?,?,0)
		ON CONFLICT(call_id) DO UPDATE SET incomplete=excluded.incomplete,omitted=excluded.omitted,unreadable=0`);

	return function nested(
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
		const nativeKey = (id: string) =>
			`native:${hash(`${origin?.key ?? outer.key}:${id}`)}`;
		// These are model API operations, not AgentTool receipts. Preserve that distinction.
		if (tool === "codemode" && Array.isArray(details["calls"])) {
			for (const value of details["calls"]) {
				const operation = object(value);
				const name = string(operation["name"]);
				const id = string(operation["id"]);
				const status = string(operation["status"]);
				if (
					!["models.classify", "models.generateImages"].includes(name) ||
					!id ||
					!["ok", "error", "cancelled", "running"].includes(status)
				)
					continue;
				const call = insertCall(
					{
						key: `model:${hash(`${outer.key}:${id}`)}`,
						callId: id,
						initiator: null,
						file: source.id,
						line,
						timestamp: outer.timestamp,
						provider: outer.provider,
						model: outer.model,
						tool: name,
						scope: "model",
						project: outer.project,
						parent: outer.id,
						unpaired: 0,
					},
					{ model: operation["args"], note: "Model input not recorded by Pi" },
				);
				recordResult(
					call,
					{
						nativeModelOperation: operation,
						note: "Model output not recorded by Pi",
						...(operation["error"] ? { error: operation["error"] } : {}),
					},
					{ entry: key, file: source.id, line, missing: 0, dropped: 0 },
					status === "ok" ? "done" : status,
				);
			}
		}
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
			if (Array.isArray(trace["nativeCallIds"])) {
				for (const id of trace["nativeCallIds"]) {
					if (typeof id === "string") linkNative.run(nativeKey(id), call.id);
				}
			}
		}

		if (message["nestedCalls"] === undefined) return;
		const native = object(message["nestedCalls"]);
		const calls = Array.isArray(native["calls"]) ? native["calls"] : [];
		if (Array.isArray(native["calls"])) nativeRecorded.run(outer.id);
		// Old/dropped snapshots and snapshots taken before scope drainage cannot prove
		// which native receipts PCC already represents. Expose omissions, never guess by name/args.
		const ambiguousMixed =
			(Array.isArray(details["traces"]) ||
				Number(details["droppedTraceCount"]) > 0) &&
			(traces.some((value) => {
				const trace = object(value);
				return (
					!Array.isArray(trace["nativeCallIds"]) ||
					["running", "blocked"].includes(string(trace["status"]))
				);
			}) ||
				traces.length === 0 ||
				Number(details["droppedTraceCount"]) > 0);
		let omitted = 0;
		let invalid = !Array.isArray(native["calls"]);
		const seen = new Set<string>();
		for (const value of calls) {
			const receipt = object(value);
			const id = string(receipt["id"]);
			const name = string(receipt["name"]);
			const status = string(receipt["status"]);
			if (!id || !name || !["ok", "error", "unfinished"].includes(status)) {
				invalid = true;
				continue;
			}
			if (seen.has(id)) continue;
			seen.add(id);
			if (status === "unfinished") invalid = true;
			const identity = nativeKey(id);
			if (findNative.get(identity)) continue;
			if (ambiguousMixed) {
				omitted++;
				continue;
			}
			const missing = receipt["arguments"] === undefined;
			const call = insertCall(
				{
					key: identity,
					callId: id,
					initiator: null,
					file: source.id,
					line,
					timestamp: origin?.timestamp ?? outer.timestamp,
					provider: origin?.provider ?? outer.provider,
					model: origin?.model ?? outer.model,
					tool: name,
					scope: "nested",
					project: source.project,
					parent: origin?.id ?? outer.id,
					unpaired: 0,
				},
				missing
					? {
							note: "Arguments not recorded",
							argumentsBytes: receipt["argumentsBytes"],
						}
					: receipt["arguments"],
			);
			// A native receipt records status, not the nested tool's result or exit code.
			recordResult(
				call,
				{
					nativeReceipt: receipt,
					note: "Native Pi receipt; result payload not recorded",
					...(status === "error" ? { error: string(receipt["error"]) } : {}),
				},
				{ entry: key, file: source.id, line, missing: 0, dropped: 0 },
				status === "ok"
					? "done"
					: status === "unfinished"
						? "running"
						: "error",
			);
			const duration = receipt["durationMs"];
			putReceipt.run({
				call: call.id,
				status,
				missing: Number(missing),
				duration:
					typeof duration === "number" &&
					Number.isFinite(duration) &&
					duration >= 0
						? duration
						: null,
			});
		}
		putCoverage.run(
			outer.id,
			Number(native["complete"] !== true || invalid),
			omitted,
		);
	};
}
