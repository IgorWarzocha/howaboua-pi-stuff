import type Database from "better-sqlite3";
import type { StoredCall } from "./calls.ts";
import { createNestedIngestor } from "./nested.ts";
import { assess, object } from "./normalise.ts";

/** Recover native model operations and diagnostic signatures from retained results. */
export function createCodemodeBackfill(db: Database.Database) {
	const nested = createNestedIngestor(db);
	const get = db.prepare<[string], { value: string }>(
		"SELECT value FROM metadata WHERE key=?",
	);
	const put = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	if (!get.get("codemodeBackfillTarget")) {
		const last = db
			.prepare<[], { id: number }>("SELECT COALESCE(MAX(id),0) id FROM calls")
			.get();
		put.run("codemodeBackfillTarget", String(last?.id ?? 0));
	}
	const target = Number(get.get("codemodeBackfillTarget")?.value ?? 0);
	const candidates = db.prepare<
		[number, number],
		StoredCall & {
			file_id: number;
			line: number;
			result: string;
			signature: string;
		}
	>(`
		SELECT c.*,p.result FROM calls c JOIN payloads p ON p.call_id=c.id
		WHERE c.tool='codemode' AND c.scope='direct' AND c.id>? AND c.id<=? ORDER BY c.id LIMIT 32
	`);
	const update = db.prepare(
		"UPDATE calls SET signature=?,preview=? WHERE id=?",
	);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	return db.transaction((): boolean => {
		const cursor = Number(get.get("codemodeBackfillCursor")?.value ?? 0);
		if (cursor >= target) return false;
		const batch = candidates.all(cursor, target);
		for (const call of batch) {
			if (!call.result_entry || !call.result) continue;
			let result;
			try {
				result = object(JSON.parse(call.result));
			} catch (error) {
				if (error instanceof SyntaxError) continue;
				throw error;
			}
			if (call.outcome === "error" && call.signature === "Script failed") {
				const next = assess(result);
				if (next.signature !== call.signature)
					update.run(next.signature, next.preview, call.id);
			}
			nested(
				{ id: call.file_id, project: call.project },
				call.line,
				call.result_entry,
				result,
				call,
				"codemode",
			);
		}
		const last = batch.at(-1)?.id ?? target;
		put.run("codemodeBackfillCursor", String(last));
		revision.run();
		return last < target;
	});
}
