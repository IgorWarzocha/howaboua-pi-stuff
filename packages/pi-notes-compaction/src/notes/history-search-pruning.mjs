import { open } from "node:fs/promises";
import { StringDecoder } from "node:string_decoder";

/** @typedef {{file:string; sessionId:string; generation:string; size:number; surviving:Set<string>; excluded:Set<string>}} PrunedHistory */

/** The live SessionManager still contains old text until restart. Read the committed
 * source so later indexing, settings toggles and /reload cannot resurrect its terms.
 */
export function createHistoryPruning() {
	/** @type {PrunedHistory | undefined} */
	let cached;
	const empty = () => false;
	/** @param {import("./sqlite.mjs").Database} db
	 * @param {string} sessionId
	 * @param {string | undefined} file
	 * @returns {Promise<(id:string) => boolean>}
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
		try {
			const { size } = await input.stat();
			if (!size) return empty;
			let header;
			for await (const entry of records(input, 0, size)) {
				header = entry;
				break;
			}
			if (header?.type !== "session" || header.id !== sessionId)
				throw new Error("History source identity changed");
			const marker = header.notesPruning;
			if (marker === undefined) return empty;
			if (
				marker?.version !== 1 ||
				marker.sessionId !== sessionId ||
				typeof marker.generation !== "string"
			)
				throw new Error("Invalid history pruning marker");
			const previous =
				cached?.file === file &&
				cached.sessionId === sessionId &&
				cached.generation === marker.generation &&
				cached.size <= size
					? cached
					: undefined;
			const incremental = previous !== undefined;
			if (previous?.size === size) return exclusion(previous);
			/** @type {PrunedHistory} */
			const source = previous ?? {
				file,
				sessionId,
				generation: marker.generation,
				size: 0,
				surviving: new Set(),
				excluded: new Set(),
			};
			// A failed suffix scan invalidates mutated cache sets. Ordinary appends
			// scan only their suffix, not the full session or every indexed document.
			cached = undefined;
			for await (const entry of records(input, source.size, size)) {
				if (!incremental && entry.type === "session") continue;
				if (typeof entry.id !== "string" || source.surviving.has(entry.id))
					throw new Error("Invalid history source entry identity");
				source.surviving.add(entry.id);
				const message = entry.type === "message" ? entry.message : undefined;
				if (
					(entry.type === "custom" &&
						entry.customType === "notes-compaction:pruned:v1") ||
					(["user", "assistant"].includes(message?.role) &&
						!visibleText(message.content))
				)
					source.excluded.add(entry.id);
			}
			source.size = size;
			const excluded = exclusion(source);
			if (!incremental) {
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
						if (!excluded(row.item_id)) continue;
						removeTerms.run(row.id);
						removeDocument.run(row.id);
					}
				}).immediate();
			}
			cached = source;
			return excluded;
		} finally {
			await input.close();
		}
	};
}

/** @param {import("node:fs/promises").FileHandle} input @param {number} start @param {number} size */
async function* records(input, start, size) {
	const buffer = Buffer.alloc(64 * 1024);
	const decoder = new StringDecoder("utf8");
	let pending = "";
	for (let position = start; position < size; ) {
		const { bytesRead } = await input.read(
			buffer,
			0,
			Math.min(buffer.length, size - position),
			position,
		);
		if (!bytesRead)
			throw new Error("History source changed during reconciliation");
		position += bytesRead;
		pending += decoder.write(buffer.subarray(0, bytesRead));
		let offset = 0;
		let end;
		while ((end = pending.indexOf("\n", offset)) >= 0) {
			yield JSON.parse(pending.slice(offset, end));
			offset = end + 1;
		}
		pending = pending.slice(offset);
	}
	pending += decoder.end();
	if (pending.length)
		throw new Error(
			"History source has an incomplete record; retry after the turn completes",
		);
}

/** @param {PrunedHistory} source */
function exclusion(source) {
	/** @param {string} id */
	return (id) => !source.surviving.has(id) || source.excluded.has(id);
}

/** @param {unknown} content */
function visibleText(content) {
	return typeof content === "string"
		? content.length > 0
		: Array.isArray(content) &&
				content.some((part) => part?.type === "text" && part.text?.length > 0);
}
