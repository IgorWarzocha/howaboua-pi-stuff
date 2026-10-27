import Database from "better-sqlite3";
import { initialiseProvenance } from "./provenance.ts";
import { installSourceReader } from "./source-records.ts";
import { initialiseSummaries } from "./summaries.ts";
import { initialiseToolObservations } from "./tool-observations.ts";
import { initialiseUsage } from "./usage.ts";

export function openDatabase(
	path: string,
	readonly = false,
): Database.Database {
	const db = new Database(path, { readonly, timeout: 1000 });
	db.pragma("foreign_keys = ON");
	installSourceReader(db);
	if (readonly) db.pragma("query_only = ON");
	else db.pragma("synchronous = NORMAL");
	return db;
}

export function initialiseDatabase(
	db: Database.Database,
	sourceRoot: string,
): void {
	const version = db.pragma("user_version", { simple: true });
	if (version !== 0 && version !== 3)
		throw new Error(
			"Obsolete index. Start the updated viewer once to rebuild it automatically from source files.",
		);
	if (version === 3) {
		const source = db
			.prepare<[], { value: string }>(
				"SELECT value FROM metadata WHERE key='sourceRoot'",
			)
			.get();
		if (source?.value !== sourceRoot)
			throw new Error(
				"This index belongs to another session directory. Choose a different --db path.",
			);
		return;
	}
	db.pragma("journal_mode = WAL");
	db.transaction(() => {
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
		CREATE TABLE IF NOT EXISTS source_records (file_id INTEGER NOT NULL REFERENCES files(id), line INTEGER NOT NULL, start INTEGER NOT NULL, length INTEGER NOT NULL, digest TEXT NOT NULL, PRIMARY KEY(file_id,line));
		CREATE TABLE IF NOT EXISTS entry_refs (
			key TEXT PRIMARY KEY, timestamp TEXT NOT NULL, role TEXT NOT NULL, reference TEXT NOT NULL
		);
		CREATE INDEX IF NOT EXISTS file_session ON files(session_id);
		CREATE TABLE IF NOT EXISTS file_entries (
			file_id INTEGER NOT NULL REFERENCES files(id), line INTEGER NOT NULL,
			entry_id TEXT NOT NULL, parent_id TEXT, entry_key TEXT NOT NULL REFERENCES entry_refs(key),
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
		CREATE VIEW IF NOT EXISTS entries AS SELECT e.key,e.timestamp,e.role,source_value(e.reference,f.path,f.identity,r.start,r.length,r.digest) text FROM entry_refs e
 JOIN source_records r ON r.file_id=json_extract(e.reference,'$.file') AND r.line=json_extract(e.reference,'$.line') JOIN files f ON f.id=r.file_id;
		CREATE TABLE IF NOT EXISTS payload_refs (
			call_id INTEGER PRIMARY KEY REFERENCES calls(id), arguments_ref TEXT NOT NULL, result_ref TEXT NOT NULL DEFAULT ''
		);
		CREATE VIEW IF NOT EXISTS payloads AS SELECT p.call_id,
 source_value(p.arguments_ref,af.path,af.identity,a.start,a.length,a.digest) arguments,
 source_value(p.result_ref,rf.path,rf.identity,r.start,r.length,r.digest) result FROM payload_refs p
 JOIN source_records a ON a.file_id=json_extract(p.arguments_ref,'$.file') AND a.line=json_extract(p.arguments_ref,'$.line') JOIN files af ON af.id=a.file_id
 LEFT JOIN source_records r ON r.file_id=json_extract(NULLIF(p.result_ref,''),'$.file') AND r.line=json_extract(NULLIF(p.result_ref,''),'$.line') LEFT JOIN files rf ON rf.id=r.file_id;
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
		db.pragma("user_version = 3");
	})();
}
