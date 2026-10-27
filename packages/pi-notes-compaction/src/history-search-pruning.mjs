import { open } from "node:fs/promises";

/** @typedef {{file:string; sessionId:string; generation:string; excluded:Set<string>}} PrunedHistory */

/** The live SessionManager still contains old text until restart. Read the committed
 * source so later indexing, settings toggles and /reload cannot resurrect its terms.
 */
export function createHistoryPruning() {
	/** @type {PrunedHistory | undefined} */
	let cached;
	const empty = new Set();
	/** @param {import("./sqlite.mjs").Database} db
	 * @param {string} sessionId
	 * @param {string | undefined} file
	 * @returns {Promise<ReadonlySet<string>>}
	 */
	return async (db, sessionId, file) => {
		if (!file) return empty;
		let input;
		try {
			input = await open(file, "r");
		} catch (error) {
			// A new Pi session may not have flushed its first message yet.
			if (error instanceof Error && "code" in error && error.code === "ENOENT")
				return empty;
			throw error;
		}
		let stream;
		try {
			const { size } = await input.stat();
			if (!size) return empty;
			stream = input.createReadStream({
				start: 0,
				end: size - 1,
				autoClose: false,
				encoding: "utf8",
			});
			/** @type {PrunedHistory | undefined} */
			let source;
			let pending = "";
			for await (const chunk of stream) {
				pending += chunk;
				let start = 0;
				let end;
				while ((end = pending.indexOf("\n", start)) >= 0) {
					const entry = JSON.parse(pending.slice(start, end));
					start = end + 1;
					if (!source) {
						if (entry.type !== "session" || entry.id !== sessionId)
							throw new Error("History source identity changed");
						const marker = entry.notesPruning;
						if (marker === undefined) return empty;
						if (
							marker?.version !== 1 ||
							marker.sessionId !== sessionId ||
							typeof marker.generation !== "string"
						)
							throw new Error("Invalid history pruning marker");
						if (
							cached?.file === file &&
							cached.sessionId === sessionId &&
							cached.generation === marker.generation
						)
							return cached.excluded;
						source = {
							file,
							sessionId,
							generation: marker.generation,
							excluded: new Set(),
						};
						continue;
					}
					const message = entry.type === "message" ? entry.message : undefined;
					if (
						(entry.type === "custom" &&
							entry.customType === "notes-compaction:pruned:v1") ||
						(["user", "assistant"].includes(message?.role) &&
							!visibleText(message.content))
					)
						source.excluded.add(entry.id);
				}
				pending = pending.slice(start);
			}
			// Only complete lines from the opened inode count. A concurrent append's
			// incomplete suffix is new history, never an old pruned conversation.
			if (!source) throw new Error("History source header is missing");
			const excluded = source.excluded;
			const removeTerms = db.prepare(
				"DELETE FROM history_terms WHERE rowid = ?",
			);
			const removeDocument = db.prepare(
				"DELETE FROM history_documents WHERE id = ?",
			);
			/** @type {import("./sqlite.mjs").Statement<[string], {id:number; item_id:string}>} */
			const documents = db.prepare(
				"SELECT id, item_id FROM history_documents WHERE session_id = ?",
			);
			db.transaction(() => {
				for (const row of documents.all(sessionId)) {
					if (!excluded.has(row.item_id)) continue;
					removeTerms.run(row.id);
					removeDocument.run(row.id);
				}
			}).immediate();
			cached = source;
			return excluded;
		} finally {
			stream?.destroy();
			await input.close();
		}
	};
}

/** @param {unknown} content */
function visibleText(content) {
	return typeof content === "string"
		? content.length > 0
		: Array.isArray(content) &&
				content.some((part) => part?.type === "text" && part.text?.length > 0);
}
