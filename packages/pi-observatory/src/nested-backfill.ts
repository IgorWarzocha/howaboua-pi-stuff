import type Database from "better-sqlite3";
import type { StoredCall } from "./calls.ts";
import { createNestedIngestor } from "./nested.ts";
import { object } from "./normalise.ts";

interface CachedResult extends StoredCall {
	file_id: number;
	line: number;
	tool: string;
	result: string;
}

/** One bounded transaction per step. Cursors and newly derived evidence commit together. */
export function createNestedBackfill(db: Database.Database) {
	const nested = createNestedIngestor(db);
	const metadata = db.prepare<[string], { value: string }>(
		"SELECT value FROM metadata WHERE key=?",
	);
	const putMeta = db.prepare(
		"INSERT INTO metadata VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
	);
	if (!metadata.get("nativeBackfillTarget")) {
		const maximum = db
			.prepare<[], { id: number }>("SELECT COALESCE(MAX(id),0) id FROM calls")
			.get();
		putMeta.run("nativeBackfillTarget", String(maximum?.id ?? 0));
	}
	const target = Number(metadata.get("nativeBackfillTarget")?.value ?? 0);
	const candidates = db.prepare<[number, number], CachedResult>(`
		SELECT c.*,p.result FROM calls c JOIN payloads p ON p.call_id=c.id
		WHERE c.id>? AND c.id<=? AND c.scope='direct' ORDER BY c.id LIMIT 16
	`);
	const unreadable =
		db.prepare(`INSERT INTO nested_coverage(call_id,unreadable) VALUES (?,1)
		ON CONFLICT(call_id) DO UPDATE SET unreadable=1`);
	const revision = db.prepare(
		"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
	);
	return db.transaction((): boolean => {
		const cursor = Number(metadata.get("nativeBackfillCursor")?.value ?? 0);
		if (cursor >= target) return false;
		const batch = candidates.all(cursor, target);
		for (const call of batch) {
			if (!call.result || !call.result_entry) continue;
			let message: ReturnType<typeof object>;
			try {
				message = object(JSON.parse(call.result));
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				// Cached payloads can be capped mid-JSON. Never reread source files to fill this gap.
				unreadable.run(call.id);
				continue;
			}
			nested(
				{ id: call.file_id, project: call.project },
				call.line,
				call.result_entry,
				message,
				call,
				call.tool,
			);
		}
		const last = batch.at(-1)?.id ?? target;
		putMeta.run("nativeBackfillCursor", String(last));
		revision.run();
		return last < target;
	});
}
