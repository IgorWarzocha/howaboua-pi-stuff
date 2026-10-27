import type Database from "better-sqlite3";
import { assess, type JsonObject } from "./normalise.ts";
import { createProvenance } from "./provenance.ts";
import { sourceRecipe } from "./source-records.ts";
import { createUsageIngestor } from "./usage.ts";

export interface Source {
	id: number;
	project: string;
}

export interface StoredCall {
	id: number;
	key: string;
	provider: string;
	model: string;
	timestamp: string;
	project: string;
	outcome: string;
	result_entry: string | null;
}

export function createCallStore(db: Database.Database) {
	const usage = createUsageIngestor(db);
	const provenance = createProvenance(db);
	const putCall = db.prepare(`INSERT OR IGNORE INTO calls
		(key,call_id,initiator,file_id,line,timestamp,provider,model,tool,scope,outcome,project,parent_call_id,unpaired)
		VALUES (@key,@callId,@initiator,@file,@line,@timestamp,@provider,@model,@tool,@scope,'incomplete',@project,@parent,@unpaired)`);
	const findCall = db.prepare<[string], StoredCall>(
		"SELECT * FROM calls WHERE key=?",
	);
	const putPayload = db.prepare(
		"INSERT OR IGNORE INTO payload_refs(call_id,arguments_ref) VALUES (?,?)",
	);
	const setResult =
		db.prepare(`UPDATE calls SET outcome=@outcome,exit_code=@exitCode,signature=@signature,preview=@preview,
		result_entry=@entry,file_id=@file,line=@line,missing_traces=@missing,dropped_traces=@dropped WHERE id=@id`);
	const resultPayload = db.prepare(
		"UPDATE payload_refs SET result_ref=? WHERE call_id=?",
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
		putCall.run({ ...params, project: "unknown" });
		const stored = findCall.get(params.key);
		if (!stored) throw new Error("Indexed call was not persisted");
		putPayload.run(stored.id, sourceRecipe(db, args));
		linkCall.run(params.file, stored.id);
		if (params.parent !== null) inheritFiles.run(stored.id, params.parent);
		else linkChildren.run(params.file, stored.id);
		stored.project = provenance.refresh(stored.id);
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
			observed?: boolean;
		},
		traceStatus?: string,
	): void {
		linkCall.run(context.file, call.id);
		usage.skillReads(call.id, result);
		const assessment = assess(result, traceStatus);
		// Partial snapshots and copied fork history must not overwrite a recorded final result.
		if (
			!context.observed &&
			call.result_entry !== null &&
			call.outcome !== "incomplete"
		) {
			usage.fileReads(call.id, assessment.outcome, result);
			return;
		}
		setResult.run({ ...assessment, ...context, id: call.id });
		resultPayload.run(sourceRecipe(db, result), call.id);
		provenance.refresh(call.id);
		usage.fileReads(call.id, assessment.outcome, result);
	}
	return { insertCall, recordResult };
}
