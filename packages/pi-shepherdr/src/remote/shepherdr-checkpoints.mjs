// @howaboua/pi-shepherdr managed bridge
import { open } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";

/** @param {import('node:fs/promises').FileHandle} file @param {number} size */
async function* reverseSessionLines(file, size) {
	let position = size;
	let partial = Buffer.alloc(0);
	while (position > 0) {
		const length = Math.min(64 * 1024, position);
		position -= length;
		const chunk = Buffer.allocUnsafe(length);
		const { bytesRead } = await file.read(chunk, 0, length, position);
		const data = Buffer.concat([chunk.subarray(0, bytesRead), partial]);
		let end = data.length;
		for (let index = data.length - 1; index >= 0; index -= 1) {
			if (data[index] !== 10) continue;
			yield data.subarray(index + 1, end);
			end = index;
		}
		partial = data.subarray(0, end);
	}
	yield partial;
}

/** @param {string} path @param {{protocol: 1, threadId: string, sessionId: string, agentName: string, storage: "session"}} identity */
export async function readPersistedNoteEntries(path, identity) {
	const file = await open(path, "r");
	try {
		const metadata = await file.stat();
		const head = Buffer.alloc(64 * 1024);
		const { bytesRead } = await file.read(head, 0, head.length, 0);
		const newline = head.subarray(0, bytesRead).indexOf(10);
		if (newline < 0) throw new Error("Invalid saved session header");
		const header = JSON.parse(head.subarray(0, newline).toString("utf8"));
		if (header.type !== "session" || header.id !== identity.threadId)
			throw new Error("Saved checkpoint owner identity changed");
		const entries = [];
		let target;
		let done = false;
		let identityChecked = false;
		let bytes = 0;
		for await (const line of reverseSessionLines(file, metadata.size)) {
			if (!line.length) continue;
			let entry;
			try {
				entry = JSON.parse(line.toString("utf8"));
			} catch {
				throw new Error(
					"Saved session contains an incomplete record; retry after the owner settles",
				);
			}
			if (
				entry.type === "custom" &&
				entry.customType === "codex-context-agent" &&
				entry.data?.threadId === identity.threadId
			) {
				if (identityChecked || !isDeepStrictEqual(entry.data, identity))
					throw new Error("Saved checkpoint owner identity changed");
				identityChecked = true;
			}
			if (done || typeof entry.id !== "string" || entry.type === "session")
				continue;
			target ??= entry.id;
			if (entry.id !== target) continue;
			if (
				(entry.type === "custom" &&
					[
						"codex-context-note",
						"codex-context-note-snapshot",
						"notes-compaction:note:v1",
					].includes(entry.customType)) ||
				(entry.type === "branch_summary" &&
					entry.details?.codexContextNoteHandoff)
			) {
				bytes += line.length;
				if (bytes > 7 * 1024 * 1024)
					throw new Error("Saved checkpoints exceed the transport limit");
				entries.push(entry);
			}
			if (
				entry.type === "custom" &&
				entry.customType === "codex-context-note-snapshot"
			)
				done = true;
			if (typeof entry.parentId !== "string") done = true;
			else target = entry.parentId;
		}
		if (!identityChecked)
			throw new Error("Saved checkpoint owner identity is unavailable");
		const after = await file.stat();
		if (after.size !== metadata.size || after.mtimeMs !== metadata.mtimeMs)
			throw new Error(
				"Saved checkpoint owner is changing; retry after it settles",
			);
		return { entries: entries.reverse(), savedAt: metadata.mtimeMs };
	} finally {
		await file.close();
	}
}
