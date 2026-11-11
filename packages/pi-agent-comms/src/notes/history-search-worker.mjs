import { createHash } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { parentPort, workerData } from "node:worker_threads";
import { createHistoryPruning } from "./history-search-pruning.mjs";
import { openDatabase } from "./sqlite.mjs";

// Shipped as checked JavaScript: Node cannot strip TypeScript in node_modules.
// Pi's jiti resolver is not installed in worker threads.
/** @typedef {import("./history-search-protocol.js").SearchRequest} SearchRequest */
/** @typedef {import("./history-search-protocol.js").SearchResponse} SearchResponse */
/** @typedef {import("./history-search-protocol.js").PruneResult} PruneResult */
/** @type {import("./sqlite.mjs").Database | undefined} */
let database;
const pruneSession = createHistoryPruning();
/** @returns {import("./sqlite.mjs").Database} */
function open() {
	if (database) return database;
	mkdirSync(dirname(workerData.path), { recursive: true, mode: 0o700 });
	const db = openDatabase(workerData.path);
	try {
		db.exec("PRAGMA busy_timeout = 5000");
		db.exec("PRAGMA journal_mode = WAL");
		db.transaction(() => {
			/** @type {import("./sqlite.mjs").Statement<[], {user_version:number}>} */
			const versionQuery = db.prepare("PRAGMA user_version");
			const version = versionQuery.get()?.user_version;
			if (version !== 0 && version !== 1 && version !== 2 && version !== 3)
				throw new Error("Unsupported history index version");
			// Older formats indexed full transcripts without source-kind metadata.
			// They cannot be filtered safely: discard derived rows once, then
			// rebuild only the opted-in session's visible conversation text.
			if (version !== 3)
				db.exec(`
				DROP TABLE IF EXISTS history_terms;
				DROP TABLE IF EXISTS history_documents;
				DROP TABLE IF EXISTS history_sessions;
			`);
			db.exec(`
			CREATE TABLE IF NOT EXISTS history_documents (
				id INTEGER PRIMARY KEY, session_id TEXT NOT NULL,
				item_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
				UNIQUE(session_id, item_id)
			);
			CREATE VIRTUAL TABLE IF NOT EXISTS history_terms USING fts5(
				content, content='', contentless_delete=1,
				tokenize='unicode61 remove_diacritics 2'
			);
			CREATE TABLE IF NOT EXISTS history_sessions (
				session_id TEXT PRIMARY KEY, file_path TEXT
			);
			PRAGMA user_version = 3;
		`);
		}).immediate();
		db.exec(
			"CREATE TEMP TABLE search_scope (document_id INTEGER PRIMARY KEY, position INTEGER NOT NULL)",
		);
		database = db;
		return db;
	} catch (error) {
		db.close();
		throw error;
	}
}
/** @param {Extract<SearchRequest, {action:"index"}>} request */
async function index(request) {
	if (!database && !request.items.length && !existsSync(workerData.path))
		return null;
	const db = open();
	const excluded = await pruneSession(db, request.sessionId, request.file);
	/** @type {import("./sqlite.mjs").Statement<[string,string], {id:number; fingerprint:string}>} */
	const find = db.prepare(
		"SELECT id, fingerprint FROM history_documents WHERE session_id = ? AND item_id = ?",
	);
	const insert = db.prepare(
		"INSERT INTO history_documents(session_id, item_id, fingerprint) VALUES (?, ?, ?)",
	);
	const update = db.prepare(
		"UPDATE history_documents SET fingerprint = ? WHERE id = ?",
	);
	const removeTerms = db.prepare("DELETE FROM history_terms WHERE rowid = ?");
	const addTerms = db.prepare(
		"INSERT INTO history_terms(rowid, content) VALUES (?, ?)",
	);
	db.transaction(() => {
		db.prepare(
			"INSERT INTO history_sessions VALUES (?, ?) ON CONFLICT(session_id) DO UPDATE SET file_path = coalesce(excluded.file_path, file_path)",
		).run(request.sessionId, request.file ?? null);
		const removeDocument = db.prepare(
			"DELETE FROM history_documents WHERE session_id = ? AND item_id = ?",
		);
		for (const id of request.removeIds) {
			const existing = find.get(request.sessionId, id);
			if (existing) {
				removeTerms.run(existing.id);
				removeDocument.run(request.sessionId, id);
			}
		}
		for (const item of request.items) {
			if (excluded.has(item.item_id)) continue;
			const fingerprint = createHash("sha256")
				.update(item.content)
				.digest("hex");
			const existing = find.get(request.sessionId, item.item_id);
			if (existing?.fingerprint === fingerprint) continue;
			const id =
				existing?.id ??
				Number(
					insert.run(request.sessionId, item.item_id, fingerprint)
						.lastInsertRowid,
				);
			if (existing) {
				removeTerms.run(id);
				update.run(fingerprint, id);
			}
			addTerms.run(id, item.content);
		}
	}).immediate();
	return null;
}
/** @param {Extract<SearchRequest, {action:"search"}>} request */
function search(request) {
	const db = open();
	return db
		.transaction(() => {
			db.exec("DELETE FROM search_scope");
			const scope = db.prepare(
				"INSERT INTO search_scope SELECT id, ? FROM history_documents WHERE session_id = ? AND item_id = ?",
			);
			for (const [position, id] of request.ids.entries())
				scope.run(position, request.sessionId, id);
			/** @type {import("./sqlite.mjs").Statement<[string,number], {item_id:string}>} */
			const select = db.prepare(`
			SELECT history_documents.item_id FROM history_terms
			JOIN search_scope ON search_scope.document_id = history_terms.rowid
			JOIN history_documents ON history_documents.id = history_terms.rowid
			WHERE history_terms MATCH ?
			ORDER BY ${request.recentFirst ? "search_scope.position DESC" : "rank, search_scope.position"}
			LIMIT ?
		`);
			return select
				.all(request.match, request.limit + 1)
				.map((row) => row.item_id);
		})
		.immediate();
}
/** @param {string} activeSessionId
 * @param {Record<string,string|null>} sources
 * @returns {PruneResult}
 */
function prune(activeSessionId, sources) {
	const result = {
		removed: 0,
		unknownPaths: 0,
		inaccessible: 0,
		storageBusy: false,
	};
	// Prune does not create an index for users who never enabled ranking.
	if (!database && !existsSync(workerData.path)) return result;
	const db = open();
	// A source can acquire a saved path after indexing. Borrow proven ownership
	// before Notes removes its missing-file records; never infer unknown paths.
	db.transaction(() => {
		const source = db.prepare(
			"INSERT INTO history_sessions SELECT DISTINCT session_id, ? FROM history_documents WHERE session_id = ? ON CONFLICT(session_id) DO UPDATE SET file_path = coalesce(excluded.file_path, file_path)",
		);
		for (const [id, file] of Object.entries(sources)) source.run(file, id);
	}).immediate();
	/** @type {import("./sqlite.mjs").Statement<[], {session_id:string;file_path:string|null}>} */
	const owners = db.prepare(`
		SELECT session_id, file_path FROM history_sessions
		UNION SELECT DISTINCT session_id, NULL FROM history_documents
		WHERE session_id NOT IN (SELECT session_id FROM history_sessions)
	`);
	const sessions = owners.all();
	const remove = db.transaction(
		/** @param {string} id */ (id) => {
			db.prepare(
				"DELETE FROM history_terms WHERE rowid IN (SELECT id FROM history_documents WHERE session_id = ?)",
			).run(id);
			db.prepare("DELETE FROM history_documents WHERE session_id = ?").run(id);
			db.prepare("DELETE FROM history_sessions WHERE session_id = ?").run(id);
		},
	);
	for (const session of sessions) {
		if (session.session_id === activeSessionId) continue;
		if (!session.file_path) {
			result.unknownPaths++;
			continue;
		}
		try {
			statSync(session.file_path);
		} catch (error) {
			if (
				error instanceof Error &&
				"code" in error &&
				error.code === "ENOENT"
			) {
				remove.immediate(session.session_id);
				result.removed++;
			} else result.inaccessible++;
		}
	}
	// Manual maintenance only: merge FTS deletion segments, reclaim free pages,
	// then truncate the WAL. Other live agents may hold a reader/writer lock.
	try {
		db.exec("INSERT INTO history_terms(history_terms) VALUES ('optimize')");
		db.exec("VACUUM");
		/** @type {import("./sqlite.mjs").Statement<[], {busy:number}>} */
		const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)");
		result.storageBusy = checkpoint.all().some((row) => row.busy !== 0);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			typeof error.code === "string" &&
			error.code.startsWith("SQLITE_BUSY")
		)
			result.storageBusy = true;
		else throw error;
	}
	return result;
}
const port = parentPort;
if (!port) throw new Error("History search must run in its worker thread");
let queue = Promise.resolve();
port.on(
	"message",
	/** @param {{id:number;request:SearchRequest}} message */
	({ id, request }) => {
		// Source reconciliation is asynchronous; preserve the worker's former
		// synchronous request order so a search cannot overtake index cleanup.
		queue = queue.then(async () => {
			try {
				let value;
				if (request.action === "prune_session") {
					if (database || existsSync(workerData.path))
						await pruneSession(open(), request.sessionId, request.file);
					value = null;
				} else
					value =
						request.action === "index"
							? await index(request)
							: request.action === "search"
								? search(request)
								: prune(request.activeSessionId, request.sources);
				port.postMessage(/** @satisfies {SearchResponse} */ ({ id, value }));
			} catch (error) {
				port.postMessage(
					/** @satisfies {SearchResponse} */ ({
						id,
						error: error instanceof Error ? error.message : String(error),
					}),
				);
			}
		});
	},
);
