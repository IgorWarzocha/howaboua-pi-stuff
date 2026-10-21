import type Database from "better-sqlite3";
import { type JsonObject, string, timestamp } from "./normalise.ts";

/** Headers were not retained by older indexes. Recover them without replaying their bodies. */
export function initialiseProvenance(db: Database.Database): void {
	db.exec(`
		CREATE TABLE IF NOT EXISTS session_headers (
			file_id INTEGER PRIMARY KEY REFERENCES files(id), timestamp TEXT NOT NULL,
			parent_path TEXT, is_session INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS session_parent ON session_headers(parent_path);
		CREATE INDEX IF NOT EXISTS file_entry_identity ON file_entries(file_id,entry_key);
	`);
	if (db.prepare("SELECT 1 FROM metadata WHERE key='forkProvenance'").get())
		return;
	db.transaction(() => {
		// The old first-copy-wins project is not evidence of origin, even if its file vanished.
		db.exec(`
			DELETE FROM skill_file_sources WHERE authoritative=0;
			INSERT OR IGNORE INTO skill_file_replay SELECT id FROM calls WHERE outcome='ok';
			UPDATE calls SET project='unknown' WHERE project<>'unknown';
			INSERT INTO metadata VALUES ('forkProvenance','1');
			UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
		`);
	})();
}

interface Header {
	id: number;
	project: string;
	timestamp: string;
	parent_path: string | null;
	is_session: number;
}

export function createProvenance(db: Database.Database) {
	const putHeader = db.prepare(
		"INSERT OR REPLACE INTO session_headers VALUES (?,?,?,?)",
	);
	const setHeader = db.prepare(
		"UPDATE files SET session_id=?,project=? WHERE id=?",
	);
	const header = db.prepare<[number], Header>(`
		SELECT f.id,f.project,h.timestamp,h.parent_path,h.is_session
		FROM files f JOIN session_headers h ON h.file_id=f.id WHERE f.id=?
	`);
	const parent = db.prepare<[string], { id: number }>(
		"SELECT id FROM files WHERE path=?",
	);
	const copied = db.prepare<[number, string], { found: number }>(
		"SELECT 1 found FROM file_entries WHERE file_id=? AND entry_key=? LIMIT 1",
	);
	const memberships = db.prepare<[string], { file_id: number }>(
		"SELECT DISTINCT file_id FROM file_entries WHERE entry_key=?",
	);
	const origin = db.prepare<
		[number],
		{ key: string | null; timestamp: string; parent_call_id: number | null }
	>(`
		SELECT COALESCE(c.initiator,c.result_entry) key,
			COALESCE(e.timestamp,c.timestamp) timestamp,c.parent_call_id
		FROM calls c LEFT JOIN entries e ON e.key=COALESCE(c.initiator,c.result_entry) WHERE c.id=?
	`);
	const project = db.prepare<[number], { project: string }>(
		"SELECT project FROM calls WHERE id=?",
	);
	const update = db.prepare<
		{ id: number; project: string },
		{ id: number; outcome: string }
	>(`
		WITH RECURSIVE family(id) AS (
			SELECT @id UNION SELECT c.id FROM calls c JOIN family f ON c.parent_call_id=f.id
		)
		UPDATE calls SET project=@project WHERE id IN family AND project<>@project RETURNING id,outcome
	`);
	const replay = db.prepare(
		"INSERT OR IGNORE INTO skill_file_replay VALUES (?)",
	);
	// Keep each header repair bounded to its descendant entries, not the whole index.
	const affected = db.prepare<[number], { id: number }>(`
		WITH RECURSIVE descendants(id,path) AS (
			SELECT id,path FROM files WHERE id=?
			UNION SELECT f.id,f.path FROM descendants d JOIN session_headers h ON h.parent_path=d.path
			JOIN files f ON f.id=h.file_id
		), keys AS MATERIALIZED (
			SELECT DISTINCT e.entry_key FROM descendants d
			CROSS JOIN file_entries e INDEXED BY file_entry_identity ON e.file_id=d.id
		)
		SELECT c.id FROM keys k CROSS JOIN calls c INDEXED BY call_initiator ON c.initiator=k.entry_key
		UNION SELECT c.id FROM keys k CROSS JOIN calls c INDEXED BY call_result ON c.result_entry=k.entry_key WHERE c.unpaired=1 AND c.parent_call_id IS NULL
	`);

	function entryProject(file: number, key: string, at: string): string {
		const seen = new Set<number>();
		let current = header.get(file);
		while (current?.is_session && !seen.has(current.id)) {
			seen.add(current.id);
			if (!current.parent_path) return current.project;
			const ancestor = parent.get(current.parent_path);
			// Pi preserves copied entry timestamps and stamps newly appended entries at append time.
			// Exact membership wins over clocks; equal/missing timestamps cannot prove a new entry.
			if (!(ancestor && copied.get(ancestor.id, key))) {
				if (!at || !current.timestamp || at === current.timestamp)
					return "unknown";
				if (at > current.timestamp) return current.project;
			}
			current = ancestor ? header.get(ancestor.id) : undefined;
		}
		return "unknown";
	}

	function refresh(id: number): string {
		const call = origin.get(id);
		if (!call) throw new Error("Indexed call is missing its origin");
		let value = "unknown";
		const key = call.key;
		if (call.parent_call_id !== null)
			value = project.get(call.parent_call_id)?.project ?? "unknown";
		else if (key) {
			const known = new Set(
				memberships
					.all(key)
					.map(({ file_id }) => entryProject(file_id, key, call.timestamp))
					.filter((item) => item !== "unknown"),
			);
			if (known.size === 1) value = [...known][0] ?? "unknown";
		}
		for (const changed of update.all({ id, project: value })) {
			if (changed.outcome === "ok") replay.run(changed.id);
		}
		return value;
	}

	function recordHeader(file: number, record: JsonObject): void {
		const session = record["type"] === "session";
		if (session)
			setHeader.run(
				string(record["id"], "unknown"),
				string(record["cwd"], "unknown"),
				file,
			);
		putHeader.run(
			file,
			session ? timestamp(record["timestamp"]) : "",
			session ? string(record["parentSession"]) || null : null,
			Number(session),
		);
		for (const call of affected.all(file)) refresh(call.id);
	}
	return { recordHeader, refresh };
}
