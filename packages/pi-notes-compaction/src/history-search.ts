import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

interface SearchItem {
	item_id: string;
	content: string;
}
interface IndexedItem {
	id: number;
	item_id: string;
	fingerprint: string;
}

/** Rebuildable term index. JSONL owns text and the caller owns branch membership. */
export class HistorySearch {
	private db: Database.Database | undefined;
	private readonly path: string;
	constructor(path: string) {
		this.path = path;
	}

	private open(): Database.Database {
		if (this.db) return this.db;
		mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
		const db = new Database(this.path);
		try {
			db.pragma("busy_timeout = 5000");
			db.pragma("journal_mode = WAL");
			const version = db.pragma("user_version", { simple: true });
			if (version !== 0 && version !== 1)
				throw new Error("Unsupported history index version");
			db.exec(`
				CREATE TABLE IF NOT EXISTS history_documents (
					id INTEGER PRIMARY KEY,
					session_id TEXT NOT NULL,
					item_id TEXT NOT NULL,
					fingerprint TEXT NOT NULL,
					UNIQUE(session_id, item_id)
				);
				CREATE VIRTUAL TABLE IF NOT EXISTS history_terms USING fts5(
					content, content='', contentless_delete=1,
					tokenize='unicode61 remove_diacritics 2'
				);
				CREATE TEMP TABLE search_scope (
					document_id INTEGER PRIMARY KEY,
					position INTEGER NOT NULL
				);
				PRAGMA user_version = 1;
			`);
			this.db = db;
			return db;
		} catch (error) {
			db.close();
			throw error;
		}
	}

	search<T extends SearchItem>(
		sessionId: string,
		items: readonly T[],
		query: string,
		limit: number,
		recentFirst: boolean,
	): T[] {
		// Query text is data, never FTS operators, column selectors or prefix syntax.
		const words = [
			...new Set(query.toLowerCase().match(/[\p{L}\p{N}\p{M}\p{Co}]+/gu)),
		];
		if (!words.length)
			throw new Error("Supply at least one word or number to search history");
		if (!items.length) return [];
		const match = words.map((word) => `"${word}"`).join(" AND ");
		try {
			const db = this.open();
			const positions = db
				.transaction(() => {
					const indexed = new Map(
						db
							.prepare<[string], IndexedItem>(
								"SELECT id, item_id, fingerprint FROM history_documents WHERE session_id = ?",
							)
							.all(sessionId)
							.map((item) => [item.item_id, item]),
					);
					const insert = db.prepare(
						"INSERT INTO history_documents(session_id, item_id, fingerprint) VALUES (?, ?, ?)",
					);
					const update = db.prepare(
						"UPDATE history_documents SET fingerprint = ? WHERE id = ?",
					);
					const removeTerms = db.prepare(
						"DELETE FROM history_terms WHERE rowid = ?",
					);
					const addTerms = db.prepare(
						"INSERT INTO history_terms(rowid, content) VALUES (?, ?)",
					);
					const scope = db.prepare("INSERT INTO search_scope VALUES (?, ?)");
					db.exec("DELETE FROM search_scope");
					for (const [position, item] of items.entries()) {
						const fingerprint = createHash("sha256")
							.update(item.content)
							.digest("hex");
						const existing = indexed.get(item.item_id);
						const id =
							existing?.id ??
							Number(
								insert.run(sessionId, item.item_id, fingerprint)
									.lastInsertRowid,
							);
						if (!existing || existing.fingerprint !== fingerprint) {
							if (existing) {
								removeTerms.run(id);
								update.run(fingerprint, id);
							}
							addTerms.run(id, item.content);
						}
						scope.run(id, position);
					}
					return db
						.prepare<[string, number], { position: number }>(`
					SELECT search_scope.position FROM history_terms
					JOIN search_scope ON search_scope.document_id = history_terms.rowid
					WHERE history_terms MATCH ?
					ORDER BY ${recentFirst ? "search_scope.position DESC" : "rank, search_scope.position"}
					LIMIT ?
				`)
						.all(match, limit + 1);
				})
				.immediate();
			return positions.map(({ position }) => items[position]!);
		} catch (error) {
			throw new Error(
				"History search is unavailable. list_items and read_item still work. Ask the user to check local storage, then retry.",
				{ cause: error },
			);
		}
	}

	close(): void {
		this.db?.close();
		this.db = undefined;
	}
}
