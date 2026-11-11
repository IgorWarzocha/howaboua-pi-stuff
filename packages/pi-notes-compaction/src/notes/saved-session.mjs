import { createHash } from "node:crypto";
import { open, stat } from "node:fs/promises";
import {
	isTreeArchiveManifestData,
	MAX_ARCHIVE_DEPTH,
	TREE_ARCHIVE_ENTRY_TYPE,
} from "./tree-archive-manifest.mjs";

/** @param {unknown} value @returns {value is Record<string, unknown>} */
function object(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** @param {unknown} value @returns {value is {type:"session",id:string}} */
function isSessionHeader(value) {
	return (
		object(value) &&
		value["type"] === "session" &&
		typeof value["id"] === "string"
	);
}
/** @param {unknown} value @returns {value is import("@earendil-works/pi-coding-agent").SessionEntry} */
function isRecord(value) {
	return (
		object(value) &&
		typeof value["type"] === "string" &&
		typeof value["id"] === "string" &&
		(value["parentId"] === null || typeof value["parentId"] === "string") &&
		typeof value["timestamp"] === "string"
	);
}
/** @param {unknown} value @returns {value is import("@earendil-works/pi-coding-agent").CustomEntry} */
function isCustom(value) {
	return (
		isRecord(value) &&
		value.type === "custom" &&
		typeof value.customType === "string" &&
		"data" in value
	);
}
/** @param {unknown} value @returns {value is import("@earendil-works/pi-coding-agent").BranchSummaryEntry} */
function isHandoff(value) {
	return (
		isRecord(value) &&
		value.type === "branch_summary" &&
		typeof value.fromId === "string" &&
		typeof value.summary === "string" &&
		object(value.details) &&
		"codexContextNoteHandoff" in value.details
	);
}
const NOTE_ENTRIES = new Set([
	"notes-compaction:note:v1",
	"notes-compaction:cache:v1",
	"codex-context-note",
	"codex-context-note-snapshot",
]);
const SHARING_ENTRIES = new Set([
	"codex-context-agent",
	"codex-context-backend",
	"herdr-context-child",
	"shepherdr-attachment-route",
	"shepherdr-attachment-owner",
	"shepherdr-attachment-detached",
]);

/** @param {import("node:fs/promises").FileHandle} file @param {number} size @param {AbortSignal} [signal] */
async function* reverseChunks(file, size, signal) {
	let position = size;
	while (position > 0) {
		signal?.throwIfAborted();
		const length = Math.min(64 * 1024, position);
		position -= length;
		const chunk = Buffer.allocUnsafe(length);
		let offset = 0;
		while (offset < length) {
			const { bytesRead } = await file.read(
				chunk,
				offset,
				length - offset,
				position + offset,
			);
			if (!bytesRead)
				throw new Error(
					"Saved notes changed during the read. Retry the lookup.",
				);
			offset += bytesRead;
		}
		yield chunk;
	}
}

/** @param {import("node:fs/promises").FileHandle} file @param {number} size @param {import("node:crypto").Hash} hash @param {AbortSignal} [signal] */
async function* reverseLines(file, size, hash, signal) {
	/** @type {Buffer[]} */
	let parts = [];
	for await (const chunk of reverseChunks(file, size, signal)) {
		hash.update(chunk);
		let end = chunk.length;
		for (let index = chunk.length - 1; index >= 0; index--) {
			if (chunk[index] !== 10) continue;
			const tail = chunk.subarray(index + 1, end);
			// Long JSONL records span many chunks. Scan each byte once and join
			// fragments only at the newline, rather than recopying a growing line.
			if (parts.length) {
				parts.push(tail);
				yield Buffer.concat(parts.reverse());
				parts = [];
			} else yield tail;
			end = index;
		}
		if (end) parts.push(chunk.subarray(0, end));
	}
	yield Buffer.concat(parts.reverse());
}

/** Read only recorded session paths. Identity is session-wide; notes follow the active parent chain. */
/** @param {string} path @param {AbortSignal} [signal] @param {boolean} [history] @returns {Promise<import("./saved-session.js").SavedNotesSession>} */
export async function readSavedNotesSession(path, signal, history = false) {
	signal?.throwIfAborted();
	const file = await open(path, "r");
	try {
		const before = await file.stat();
		const hash = createHash("sha256");
		/** @type {import("@earendil-works/pi-coding-agent").SessionEntry[]} */
		const entries = [];
		/** @type {import("@earendil-works/pi-coding-agent").SessionEntry[]} */
		const branch = [];
		/** @type {Map<string, {base:string|null,depth:number}[]>} */
		const archived = new Map();
		/** @type {string | undefined} */
		let threadId;
		/** @type {string | null | undefined} */
		let target;
		for await (const line of reverseLines(file, before.size, hash, signal)) {
			signal?.throwIfAborted();
			if (!line.length) continue;
			/** @type {unknown} */
			let entry;
			try {
				entry = JSON.parse(line.toString("utf8"));
			} catch {
				throw new Error(
					"Saved notes are being updated. Retry after the session settles.",
				);
			}
			if (isSessionHeader(entry)) {
				threadId = entry.id;
				continue;
			}
			if (!isRecord(entry)) throw new Error("Invalid saved session record");
			if (target === undefined) target = entry.id;
			const active = entry.id === target;
			if (active) target = entry.parentId;
			if (history) {
				// Pi appends descendants after their parents, including Tree manifests
				// after their archived leaves. Follow only active manifests' ancestry.
				const paths = archived.get(entry.id) ?? [];
				archived.delete(entry.id);
				for (const path of paths) {
					if (++path.depth >= MAX_ARCHIVE_DEPTH || entry.parentId === path.base)
						continue;
					if (entry.parentId !== null) {
						const parents = archived.get(entry.parentId) ?? [];
						parents.push(path);
						archived.set(entry.parentId, parents);
					}
				}
				if (
					active &&
					isCustom(entry) &&
					entry.customType === TREE_ARCHIVE_ENTRY_TYPE &&
					isTreeArchiveManifestData(entry.data) &&
					entry.data.archivedLeafId !== entry.data.branchBaseId
				) {
					const paths = archived.get(entry.data.archivedLeafId) ?? [];
					paths.push({ base: entry.data.branchBaseId, depth: 0 });
					archived.set(entry.data.archivedLeafId, paths);
				}
				if (
					active ||
					paths.length ||
					(isCustom(entry) && SHARING_ENTRIES.has(entry.customType))
				)
					entries.push(entry);
				if (active) branch.push(entry);
				continue;
			}
			if (isCustom(entry)) {
				if (SHARING_ENTRIES.has(entry.customType)) entries.push(entry);
				else if (active && NOTE_ENTRIES.has(entry.customType))
					branch.push(entry);
				else continue;
			} else if (active && isHandoff(entry)) branch.push(entry);
			else continue;
		}
		// Pruning replaces the path. An open descriptor alone still sees the old inode.
		const after = await stat(path);
		if (
			after.dev !== before.dev ||
			after.ino !== before.ino ||
			after.size < before.size ||
			(after.size === before.size &&
				(after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs))
		)
			throw new Error("Saved notes changed during the read. Retry the lookup.");
		if (after.size > before.size) {
			// Flushed Pi sessions append. Keep the original leaf/byte boundary,
			// but prove its prefix did not change, including abandoned identities.
			// Hash the same reverse chunks, without retaining the whole JSONL.
			const verified = createHash("sha256");
			for await (const chunk of reverseChunks(file, before.size, signal))
				verified.update(chunk);
			if (hash.digest("hex") !== verified.digest("hex"))
				throw new Error(
					"Saved notes changed during the read. Retry the lookup.",
				);
			const current = await stat(path);
			if (
				current.dev !== before.dev ||
				current.ino !== before.ino ||
				current.size < after.size ||
				(current.size === after.size &&
					(current.mtimeMs !== after.mtimeMs ||
						current.ctimeMs !== after.ctimeMs))
			)
				throw new Error(
					"Saved notes changed during the read. Retry the lookup.",
				);
		}
		if (!threadId || (target !== undefined && target !== null))
			throw new Error("Saved notes have an incomplete session branch");
		return {
			threadId,
			entries: entries.reverse(),
			branch: branch.reverse(),
			savedAt: before.mtimeMs,
		};
	} finally {
		await file.close();
	}
}
