import { setImmediate } from "node:timers/promises";
import type Database from "better-sqlite3";

/** Repair recipes from copied history to its indexed parent, never to an arbitrary copy. */
export function createSourceOwnership(db: Database.Database) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS source_ownership_replay (entry_key TEXT PRIMARY KEY);
		CREATE INDEX IF NOT EXISTS payload_arguments_source ON payload_refs(json_extract(arguments_ref,'$.file'),json_extract(arguments_ref,'$.line'));
		CREATE INDEX IF NOT EXISTS payload_result_source ON payload_refs(json_extract(NULLIF(result_ref,''),'$.file'),json_extract(NULLIF(result_ref,''),'$.line'));
	`);
	db.prepare(
		"INSERT OR IGNORE INTO metadata VALUES ('sourceOwnershipCursor','0')",
	).run();
	const migration = db.prepare<[], { value: string }>(
		"SELECT value FROM metadata WHERE key='sourceOwnershipCursor'",
	);
	const advance = db.prepare(
		"UPDATE metadata SET value=? WHERE key='sourceOwnershipCursor'",
	);
	const history = db.prepare<[number], { rowid: number; entry_key: string }>(
		"SELECT rowid,entry_key FROM file_entries WHERE rowid>? ORDER BY rowid LIMIT 64",
	);
	const enqueue = db.prepare(`INSERT OR IGNORE INTO source_ownership_replay
		SELECT ? WHERE (SELECT COUNT(*) FROM (SELECT 1 FROM file_entries WHERE entry_key=? LIMIT 2))=2`);
	const descendants = db.prepare(`
		WITH RECURSIVE descendants(id,path) AS (
			SELECT id,path FROM files WHERE id=?
			UNION SELECT f.id,f.path FROM descendants d
			JOIN session_headers h ON h.parent_path=d.path JOIN files f ON f.id=h.file_id
		)
		INSERT OR IGNORE INTO source_ownership_replay
		SELECT e.entry_key FROM descendants d
		CROSS JOIN file_entries e INDEXED BY file_entry_identity ON e.file_id=d.id
		WHERE EXISTS (SELECT 1 FROM file_entries other WHERE other.entry_key=e.entry_key AND other.file_id<>e.file_id)
	`);
	const seed = db.transaction(() => {
		const cursor = migration.get()?.value;
		if (cursor === "done") return false;
		const rows = history.all(Number(cursor));
		for (const row of rows) enqueue.run(row.entry_key, row.entry_key);
		advance.run(rows.length ? String(rows[rows.length - 1]?.rowid) : "done");
		return rows.length > 0;
	});
	const batch = db.prepare<[], { entry_key: string }>(
		"SELECT entry_key FROM source_ownership_replay LIMIT 64",
	);
	const remove = db.prepare(
		"DELETE FROM source_ownership_replay WHERE entry_key=?",
	);
	const copies = db.prepare<[string], { file_id: number; line: number }>(
		"SELECT file_id,line FROM file_entries WHERE entry_key=?",
	);
	const ancestor = db.prepare<
		[number, string],
		{ file_id: number; line: number }
	>(`
		WITH RECURSIVE ancestry(id,depth) AS (
			SELECT ?,0 UNION ALL
			SELECT f.id,a.depth+1 FROM ancestry a JOIN session_headers h ON h.file_id=a.id
			JOIN files f ON f.path=h.parent_path WHERE a.depth<1000
		)
		SELECT e.file_id,e.line FROM ancestry a JOIN file_entries e ON e.file_id=a.id
		JOIN source_records r ON r.file_id=e.file_id AND r.line=e.line
		WHERE a.depth>0 AND e.entry_key=? AND r.length>0 ORDER BY a.depth DESC LIMIT 1
	`);
	const entry =
		db.prepare(`UPDATE entry_refs SET reference=json_set(reference,'$.file',@target,'$.line',@targetLine)
		WHERE key=@key AND json_extract(reference,'$.file')=@file AND json_extract(reference,'$.line')=@line`);
	const argumentsRef =
		db.prepare(`UPDATE payload_refs SET arguments_ref=json_set(arguments_ref,'$.file',@target,'$.line',@targetLine)
		WHERE json_extract(arguments_ref,'$.file')=@file AND json_extract(arguments_ref,'$.line')=@line`);
	const resultRef =
		db.prepare(`UPDATE payload_refs SET result_ref=json_set(result_ref,'$.file',@target,'$.line',@targetLine)
		WHERE json_extract(NULLIF(result_ref,''),'$.file')=@file AND json_extract(NULLIF(result_ref,''),'$.line')=@line`);
	const repair = db.transaction((key: string) => {
		let changed = 0;
		for (const copy of copies.all(key)) {
			const target = ancestor.get(copy.file_id, key);
			if (!target || target.file_id === copy.file_id) continue;
			const params = {
				key,
				file: copy.file_id,
				line: copy.line,
				target: target.file_id,
				targetLine: target.line,
			};
			changed += entry.run(params).changes;
			changed += argumentsRef.run(params).changes;
			changed += resultRef.run(params).changes;
		}
		remove.run(key);
		if (changed)
			db.prepare(
				"UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision'",
			).run();
	});
	async function replay(keepGoing: () => boolean): Promise<void> {
		while (keepGoing()) {
			const seeded = seed();
			const keys = batch.all();
			if (!keys.length && !seeded) return;
			for (const { entry_key } of keys) {
				if (!keepGoing()) return;
				repair(entry_key);
			}
			await setImmediate();
		}
	}
	return {
		replay,
		queueDescendants(file: number): void {
			descendants.run(file);
		},
	};
}
