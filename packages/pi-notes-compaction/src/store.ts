import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { CachedResponse, LookupQuery } from "./bridge.js";
import { queryKey } from "./bridge.js";

export interface SessionRef {
	id: string;
	file: string | undefined;
}
export interface NoteRevision {
	id: string;
	path: string;
	text: string;
	mode: "replace" | "append";
	createdAt: number;
	updatedAt: number;
}
interface CacheRow {
	query_json: string;
	bytes: Buffer;
	source: string;
	encoding: string;
	fetched_at: number;
	coverage: CachedResponse["coverage"];
}

/** One connection per extension process. Read-only access never creates a database or session. */
export class NotesStore {
	private db: Database.Database | undefined;
	readonly path: string;
	constructor(path: string) {
		this.path = path;
	}
	private open(write = false): Database.Database | undefined {
		if (this.db) return this.db;
		if (!write && !existsSync(this.path)) return undefined;
		if (write) mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		const db = new Database(this.path);
		try {
			db.pragma("busy_timeout = 5000");
			db.pragma("journal_mode = WAL");
			db.pragma("foreign_keys = ON");
			const version = db.pragma("user_version", { simple: true });
			if (version !== 0 && version !== 1) {
				throw new Error("Notes database version is not supported");
			}
			db.exec(`
			CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, file_path TEXT, updated_at INTEGER NOT NULL);
			CREATE TABLE IF NOT EXISTS notes (
				id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
				path TEXT NOT NULL, text TEXT NOT NULL, mode TEXT NOT NULL,
				created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS notes_session ON notes(session_id);
			CREATE TABLE IF NOT EXISTS remote_cache (
				session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
				query_key TEXT NOT NULL, query_json TEXT NOT NULL, source TEXT NOT NULL,
				encoding TEXT NOT NULL, bytes BLOB NOT NULL, fetched_at INTEGER NOT NULL, coverage TEXT NOT NULL,
				PRIMARY KEY(session_id, query_key, source)
			);
			PRAGMA user_version = 1;
		`);
			this.db = db;
			return db;
		} catch {
			db.close();
			throw new Error(
				"Local notes storage is unavailable. History remains available. Retry when local storage is restored.",
			);
		}
	}
	private record(db: Database.Database, session: SessionRef): void {
		db.prepare(
			"INSERT INTO sessions VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET file_path = COALESCE(excluded.file_path, sessions.file_path), updated_at = excluded.updated_at",
		).run(session.id, session.file ?? null, Date.now());
	}
	/** Persist only after a real mutation. Snapshot revisions remain immutable for branch navigation. */
	write(session: SessionRef, note: Omit<NoteRevision, "id">): NoteRevision {
		const db = this.open(true)!;
		const revision = { ...note, id: randomUUID() };
		db.transaction(() => {
			this.record(db, session);
			db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?)").run(
				revision.id,
				session.id,
				revision.path,
				revision.text,
				revision.mode,
				revision.createdAt,
				revision.updatedAt,
			);
		})();
		return revision;
	}
	read(id: string): NoteRevision | undefined {
		const row = this.open()
			?.prepare(
				"SELECT id, path, text, mode, created_at AS createdAt, updated_at AS updatedAt FROM notes WHERE id = ?",
			)
			.get(id) as NoteRevision | undefined;
		return row;
	}
	updateFile(session: SessionRef): void {
		if (!session.file) return;
		this.open()
			?.prepare("UPDATE sessions SET file_path = ? WHERE id = ?")
			.run(session.file, session.id);
	}
	cache(session: SessionRef, responses: readonly CachedResponse[]): void {
		if (!responses.length) return;
		for (const response of responses) {
			if (
				!(response.bytes instanceof Uint8Array) ||
				!response.bytes.length ||
				!response.source ||
				!response.encoding ||
				!Number.isFinite(response.fetchedAt) ||
				!["complete", "partial", "unknown"].includes(response.coverage)
			)
				throw new Error("Remote lookup returned an invalid cache response");
		}
		const db = this.open(true)!;
		db.transaction(() => {
			this.record(db, session);
			const insert = db.prepare(
				"INSERT INTO remote_cache VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(session_id, query_key, source) DO UPDATE SET query_json = excluded.query_json, encoding = excluded.encoding, bytes = excluded.bytes, fetched_at = excluded.fetched_at, coverage = excluded.coverage",
			);
			for (const response of responses)
				insert.run(
					session.id,
					queryKey(response.query),
					JSON.stringify(response.query),
					response.source,
					response.encoding,
					Buffer.from(response.bytes),
					response.fetchedAt,
					response.coverage,
				);
		})();
	}
	cached(sessionIds: readonly string[], query: LookupQuery): CachedResponse[] {
		const db = this.open();
		if (!db) return [];
		const rows = sessionIds.flatMap(
			(id) =>
				db
					.prepare(
						"SELECT * FROM remote_cache WHERE session_id = ? AND query_key = ?",
					)
					.all(id, queryKey(query)) as CacheRow[],
		);
		const latest = new Map<string, CachedResponse>();
		for (const row of rows)
			if (
				!latest.has(row.source) ||
				latest.get(row.source)!.fetchedAt < row.fetched_at
			)
				latest.set(row.source, {
					query: JSON.parse(row.query_json) as LookupQuery,
					bytes: new Uint8Array(row.bytes),
					source: row.source,
					encoding: row.encoding,
					fetchedAt: row.fetched_at,
					coverage: row.coverage,
				});
		return [...latest.values()];
	}
	cachedPaths(sessionIds: readonly string[]): string[] {
		const db = this.open();
		if (!db) return [];
		const rows = sessionIds
			.flatMap(
				(id) =>
					db
						.prepare(
							"SELECT query_json, fetched_at FROM remote_cache WHERE session_id = ? ORDER BY fetched_at DESC LIMIT 20",
						)
						.all(id) as { query_json: string; fetched_at: number }[],
			)
			.sort((a, b) => b.fetched_at - a.fetched_at);
		return rows.flatMap((row) => {
			const query = JSON.parse(row.query_json) as LookupQuery;
			return query.namespace === "notes" &&
				query.params["action"] === "read_file" &&
				typeof query.params["path"] === "string"
				? [query.params["path"]]
				: [];
		});
	}
	status(): { sessions: number; revisions: number; cachedResponses: number } {
		const db = this.open();
		const count = (table: string) =>
			(
				db?.prepare(`SELECT count(*) AS n FROM ${table}`).get() as
					| { n: number }
					| undefined
			)?.n ?? 0;
		return {
			sessions: count("sessions"),
			revisions: count("notes"),
			cachedResponses: count("remote_cache"),
		};
	}
	prune(activeSessionId: string): {
		removed: number;
		unknownPaths: number;
		inaccessible: number;
	} {
		const db = this.open();
		const result = { removed: 0, unknownPaths: 0, inaccessible: 0 };
		if (!db) return result;
		const sessions = db.prepare("SELECT id, file_path FROM sessions").all() as {
			id: string;
			file_path: string | null;
		}[];
		for (const session of sessions) {
			if (session.id === activeSessionId) continue;
			if (!session.file_path) {
				result.unknownPaths++;
				continue;
			}
			try {
				statSync(session.file_path);
			} catch (error) {
				// Only missing paths prove deletion. Permission failures and malformed paths do not.
				if ((error as NodeJS.ErrnoException).code === "ENOENT") {
					db.prepare("DELETE FROM sessions WHERE id = ?").run(session.id);
					result.removed++;
				} else result.inaccessible++;
			}
		}
		return result;
	}
	close(): void {
		this.db?.close();
		this.db = undefined;
	}
}
