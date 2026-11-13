import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
	isTreeArchiveManifestData,
	TREE_ARCHIVE_ENTRY_TYPE,
} from "./tree-archive-manifest.mjs";

/** @typedef {import("@earendil-works/pi-coding-agent").SessionEntry} SessionEntry */
/** @typedef {import("@earendil-works/pi-coding-agent").SessionHeader & {notesPruning?:{version:number;sessionId:string;generation:string}}} Header */

/** A finite complete source, never a live SessionManager.
 * @param {string} path @param {number} size
 * @param {(entry:SessionEntry|Header, raw:string)=>void|Promise<void>} visit
 */
export async function scanSparseSource(path, size, visit) {
	if (!size) throw new Error("Session file is empty.");
	const input = createReadStream(path, { start: 0, end: size - 1 });
	const lines = createInterface({ input, crlfDelay: Infinity });
	let bytes = 0;
	try {
		for await (const raw of lines) {
			bytes += Buffer.byteLength(raw) + 1;
			const entry = JSON.parse(raw);
			if (
				!entry ||
				typeof entry.id !== "string" ||
				typeof entry.timestamp !== "string" ||
				typeof entry.type !== "string" ||
				(entry.type !== "session" &&
					entry.parentId !== null &&
					typeof entry.parentId !== "string")
			)
				throw new Error("Session contains an invalid record.");
			await visit(entry, raw);
		}
		if (bytes !== size)
			throw new Error("Session requires complete LF-delimited records.");
	} finally {
		lines.close();
		input.destroy();
	}
}

/** Remove only existing retired tombstones; retention/content decisions stay with
 * live Notes pruning. Keep navigation anchors and supported structured references.
 * @param {string} path @param {number} size
 */
export async function planSparsePruning(path, size) {
	/** @type {Map<string,string|null>} */
	const parents = new Map();
	/** @type {Map<string,number>} */
	const children = new Map();
	const removed = new Set();
	const anchors = new Set();
	/** @type {Header|undefined} */
	let header;
	let last;
	await scanSparseSource(path, size, (entry) => {
		if (entry.type === "session") {
			if (header || parents.size || entry.version !== 3)
				throw new Error("Session requires a single version 3 header first.");
			header = entry;
			return;
		}
		if (
			!header ||
			parents.has(entry.id) ||
			(entry.parentId !== null && !parents.has(entry.parentId))
		)
			throw new Error(
				"Session has duplicate IDs or invalid source-order ancestry.",
			);
		last = entry.id;
		parents.set(entry.id, entry.parentId);
		if (entry.parentId === null) anchors.add(entry.id);
		else children.set(entry.parentId, (children.get(entry.parentId) ?? 0) + 1);
		if (
			entry.type === "custom" &&
			entry.customType === "notes-compaction:pruned:v1"
		)
			removed.add(entry.id);
		for (const id of references(entry)) anchors.add(id);
	});
	if (!header) throw new Error("Session header is missing.");
	const marker = header.notesPruning;
	if (
		marker !== undefined &&
		(!marker ||
			marker.version !== 1 ||
			marker.sessionId !== header.id ||
			typeof marker.generation !== "string")
	)
		throw new Error(
			"The saved session has an invalid pruning generation. Session cleanup was skipped.",
		);
	if (last) anchors.add(last);
	for (const id of parents.keys()) {
		if (children.get(id) !== 1) anchors.add(id);
	}
	for (const id of anchors) removed.delete(id);
	/** @type {Map<string,string|null>} */
	const nearest = new Map();
	for (const [id, parent] of parents) {
		// Source-order ancestry makes this a linear pass, including long chains.
		const ancestor = parent === null ? null : (nearest.get(parent) ?? null);
		nearest.set(id, removed.has(id) ? ancestor : id);
		parents.set(id, ancestor);
	}
	return { removed, parents, header };
}

/** @param {SessionEntry} entry @returns {string[]} */
function references(entry) {
	if (entry.type === "compaction") return [entry.firstKeptEntryId];
	if (entry.type === "branch_summary") return [entry.fromId];
	if (entry.type === "label" || entry.type === "context_edit")
		return [entry.targetId];
	if (entry.type === "custom" && entry.customType === TREE_ARCHIVE_ENTRY_TYPE) {
		if (!isTreeArchiveManifestData(entry.data))
			throw new Error(
				"Invalid Tree archive metadata; session history was not removed.",
			);
		const data = entry.data;
		return [
			data.boundaryEntryId,
			data.summaryEntryId,
			data.archivedLeafId,
			...(data.branchBaseId ? [data.branchBaseId] : []),
			...(data.compactionEntryId ? [data.compactionEntryId] : []),
		];
	}
	return [];
}
