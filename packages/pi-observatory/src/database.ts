import Database from "better-sqlite3";
import { assess, object } from "./normalise.ts";
import { initialiseProvenance } from "./provenance.ts";
import { initialiseSummaries } from "./summaries.ts";
import { initialiseToolObservations } from "./tool-observations.ts";
import { initialiseUsage } from "./usage.ts";

export function openDatabase(
	path: string,
	readonly = false,
): Database.Database {
	const db = new Database(path, { readonly, timeout: 1000 });
	db.pragma("foreign_keys = ON");
	if (readonly) db.pragma("query_only = ON");
	else db.pragma("synchronous = NORMAL");
	return db;
}

export function initialiseDatabase(
	db: Database.Database,
	sourceRoot: string,
): void {
	db.pragma("journal_mode = WAL");
	const version = db.pragma("user_version", { simple: true });
	if (version !== 0 && version !== 1 && version !== 2)
		throw new Error(
			"Unsupported index version. Choose a new --db path to rebuild.",
		);
	db.exec(`
		CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
		CREATE TABLE IF NOT EXISTS files (
			id INTEGER PRIMARY KEY, path TEXT NOT NULL UNIQUE, identity TEXT NOT NULL,
			offset INTEGER NOT NULL DEFAULT 0, line INTEGER NOT NULL DEFAULT 0,
			tail BLOB NOT NULL DEFAULT X'', skipping INTEGER NOT NULL DEFAULT 0,
			mtime REAL NOT NULL DEFAULT 0, session_id TEXT NOT NULL DEFAULT 'unknown',
			project TEXT NOT NULL DEFAULT 'unknown', issue TEXT, blocked INTEGER NOT NULL DEFAULT 0,
			malformed INTEGER NOT NULL DEFAULT 0
		);
		CREATE TABLE IF NOT EXISTS entries (
			key TEXT PRIMARY KEY, timestamp TEXT NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS file_session ON files(session_id);
		CREATE TABLE IF NOT EXISTS file_entries (
			file_id INTEGER NOT NULL REFERENCES files(id), line INTEGER NOT NULL,
			entry_id TEXT NOT NULL, parent_id TEXT, entry_key TEXT NOT NULL REFERENCES entries(key),
			PRIMARY KEY(file_id, line)
		);
		CREATE INDEX IF NOT EXISTS entry_lookup ON file_entries(file_id, entry_id);
		CREATE INDEX IF NOT EXISTS entry_key_lookup ON file_entries(entry_key);
		CREATE TABLE IF NOT EXISTS calls (
			id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, call_id TEXT NOT NULL,
			initiator TEXT, result_entry TEXT, file_id INTEGER NOT NULL REFERENCES files(id),
			line INTEGER NOT NULL, timestamp TEXT NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL,
			tool TEXT NOT NULL, scope TEXT NOT NULL, outcome TEXT NOT NULL, exit_code INTEGER,
			signature TEXT NOT NULL DEFAULT '', preview TEXT NOT NULL DEFAULT '', project TEXT NOT NULL,
			parent_call_id INTEGER REFERENCES calls(id), unpaired INTEGER NOT NULL DEFAULT 0,
			missing_traces INTEGER NOT NULL DEFAULT 0, dropped_traces INTEGER NOT NULL DEFAULT 0
		);
		CREATE INDEX IF NOT EXISTS call_initiator ON calls(initiator, call_id);
		CREATE INDEX IF NOT EXISTS call_identifier ON calls(call_id, initiator);
		CREATE INDEX IF NOT EXISTS call_parent ON calls(parent_call_id);
		CREATE INDEX IF NOT EXISTS call_result ON calls(result_entry);
		CREATE INDEX IF NOT EXISTS call_time ON calls(timestamp DESC, id DESC);
		CREATE INDEX IF NOT EXISTS call_outcome ON calls(outcome, id DESC);
		CREATE INDEX IF NOT EXISTS call_model ON calls(provider, model, id DESC);
		CREATE INDEX IF NOT EXISTS call_tool ON calls(tool, id DESC);
		CREATE INDEX IF NOT EXISTS call_project ON calls(project, id DESC);
		CREATE TABLE IF NOT EXISTS file_calls (
			file_id INTEGER NOT NULL REFERENCES files(id), call_id INTEGER NOT NULL REFERENCES calls(id),
			PRIMARY KEY(file_id,call_id)
		) WITHOUT ROWID;
		CREATE INDEX IF NOT EXISTS call_files ON file_calls(call_id,file_id);
		CREATE TABLE IF NOT EXISTS payloads (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id), arguments TEXT NOT NULL, result TEXT NOT NULL DEFAULT ''
		);
		CREATE TABLE IF NOT EXISTS cells (
			file_id INTEGER NOT NULL REFERENCES files(id), cell_id TEXT NOT NULL,
			origin INTEGER NOT NULL REFERENCES calls(id), PRIMARY KEY(file_id, cell_id)
		);
		CREATE TABLE IF NOT EXISTS native_links (
			key TEXT PRIMARY KEY, call_id INTEGER NOT NULL REFERENCES calls(id)
		);
		CREATE TABLE IF NOT EXISTS native_receipts (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id), status TEXT NOT NULL,
			arguments_missing INTEGER NOT NULL, duration_ms REAL
		);
		CREATE TABLE IF NOT EXISTS nested_coverage (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id), incomplete INTEGER NOT NULL DEFAULT 0,
			omitted INTEGER NOT NULL DEFAULT 0, unreadable INTEGER NOT NULL DEFAULT 0
		);
		CREATE VIRTUAL TABLE IF NOT EXISTS call_search USING fts5(tool, signature, content='calls', content_rowid='id');
		CREATE TRIGGER IF NOT EXISTS calls_insert AFTER INSERT ON calls BEGIN
			INSERT INTO call_search(rowid,tool,signature) VALUES(new.id,new.tool,new.signature);
		END;
		CREATE TRIGGER IF NOT EXISTS calls_update AFTER UPDATE OF tool,signature ON calls BEGIN
			INSERT INTO call_search(call_search,rowid,tool,signature) VALUES('delete',old.id,old.tool,old.signature);
			INSERT INTO call_search(rowid,tool,signature) VALUES(new.id,new.tool,new.signature);
		END;
	`);
	initialiseSummaries(db);
	initialiseUsage(db);
	initialiseToolObservations(db);
	// Derive session membership from cached entries when adding this index. No source JSONL replay.
	if (
		!db.prepare("SELECT 1 FROM metadata WHERE key='sessionMembership'").get()
	) {
		db.transaction(() => {
			db.exec(`
				INSERT OR IGNORE INTO file_calls SELECT e.file_id,c.id FROM file_entries e JOIN calls c ON c.initiator=e.entry_key;
				INSERT OR IGNORE INTO file_calls SELECT f.file_id,c.id FROM file_calls f JOIN calls c ON c.parent_call_id=f.call_id;
				INSERT OR IGNORE INTO file_calls SELECT e.file_id,c.id FROM file_entries e JOIN calls c ON c.result_entry=e.entry_key WHERE c.unpaired=1;
				INSERT INTO metadata VALUES ('sessionMembership','1');
			`);
		})();
	}
	const source = db
		.prepare<[string], { value: string }>(
			"SELECT value FROM metadata WHERE key=?",
		)
		.get("sourceRoot");
	if (source && source.value !== sourceRoot)
		throw new Error(
			"This index belongs to another session directory. Choose a different --db path.",
		);
	db.prepare("INSERT OR IGNORE INTO metadata VALUES ('sourceRoot', ?)").run(
		sourceRoot,
	);
	db.prepare("INSERT OR IGNORE INTO metadata VALUES ('revision', '0')").run();
	initialiseProvenance(db);
	if (version === 1) reclassifyRecordedResults(db);
	else if (version === 0) db.pragma("user_version = 2");
}

function reclassifyRecordedResults(db: Database.Database): void {
	db.transaction(() => {
		// Version 1 mistook arbitrary tool details.status for this execution's status.
		// The indexed Pi result contains isError; no session files need to be replayed.
		const candidates = db
			.prepare<[], { id: number }>(`
			SELECT id FROM calls WHERE scope='direct' AND result_entry IS NOT NULL
			AND outcome IN ('error','blocked','cancelled','pending')
		`)
			.all();
		const payload = db.prepare<
			[number],
			{ result: string; outcome: string; preview: string }
		>(
			"SELECT p.result,c.outcome,c.preview FROM calls c JOIN payloads p ON p.call_id=c.id WHERE c.id=?",
		);
		const update = db.prepare(
			"UPDATE calls SET outcome=@outcome,exit_code=@exitCode,signature=@signature,preview=@preview WHERE id=@id",
		);
		for (const { id } of candidates) {
			const stored = payload.get(id);
			if (!stored) throw new Error("Indexed call payload is missing");
			let result: ReturnType<typeof assess>;
			try {
				result = assess(object(JSON.parse(stored.result)));
			} catch (error) {
				if (!(error instanceof SyntaxError)) throw error;
				// Capped payloads may no longer be valid JSON; do not invent their result.
				result = {
					outcome: "unknown",
					exitCode: null,
					signature: "",
					preview: stored.preview,
				};
			}
			if (result.outcome !== stored.outcome) update.run({ ...result, id });
		}
		db.exec(`
			UPDATE calls SET outcome='incomplete',signature='' WHERE outcome IN ('pending','blocked');
			UPDATE calls SET outcome='error' WHERE outcome='cancelled';
			UPDATE metadata SET value=CAST(value AS INTEGER)+1 WHERE key='revision';
			PRAGMA user_version = 2;
		`);
	})();
}
