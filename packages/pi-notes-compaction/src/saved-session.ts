import { type FileHandle, open } from "node:fs/promises";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

const SessionHeader = Type.Object({
	type: Type.Literal("session"),
	id: Type.String(),
});
const RecordHeader = Type.Object({
	type: Type.String(),
	id: Type.String(),
	parentId: Type.Union([Type.String(), Type.Null()]),
	timestamp: Type.String(),
});
const Custom = Type.Object({
	...RecordHeader.properties,
	type: Type.Literal("custom"),
	customType: Type.String(),
	data: Type.Unknown(),
});
const Handoff = Type.Object({
	...RecordHeader.properties,
	type: Type.Literal("branch_summary"),
	fromId: Type.String(),
	summary: Type.String(),
	details: Type.Object({ codexContextNoteHandoff: Type.Unknown() }),
});
const NOTE_ENTRIES = new Set([
	"notes-compaction:note:v1",
	"codex-context-note",
	"codex-context-note-snapshot",
]);
const SHARING_ENTRIES = new Set([
	"codex-context-agent",
	"herdr-context-child",
	"shepherdr-attachment-route",
	"shepherdr-attachment-owner",
	"shepherdr-attachment-detached",
]);

export interface SavedNotesSession {
	threadId: string;
	entries: readonly SessionEntry[];
	branch: readonly SessionEntry[];
	savedAt?: number;
}

async function* reverseLines(file: FileHandle, size: number) {
	let position = size;
	let partial = Buffer.alloc(0);
	while (position > 0) {
		const length = Math.min(64 * 1024, position);
		position -= length;
		const chunk = Buffer.allocUnsafe(length);
		const { bytesRead } = await file.read(chunk, 0, length, position);
		const data = Buffer.concat([chunk.subarray(0, bytesRead), partial]);
		let end = data.length;
		for (let index = data.length - 1; index >= 0; index--) {
			if (data[index] !== 10) continue;
			yield data.subarray(index + 1, end);
			end = index;
		}
		partial = data.subarray(0, end);
	}
	yield partial;
}

/** Read only recorded session paths. Identity is session-wide; notes follow the active parent chain. */
export async function readSavedNotesSession(
	path: string,
	signal?: AbortSignal,
	history = false,
): Promise<SavedNotesSession> {
	signal?.throwIfAborted();
	const file = await open(path, "r");
	try {
		const before = await file.stat();
		const entries: SessionEntry[] = [];
		const branch: SessionEntry[] = [];
		let threadId: string | undefined;
		let target: string | null | undefined;
		for await (const line of reverseLines(file, before.size)) {
			signal?.throwIfAborted();
			if (!line.length) continue;
			let entry: unknown;
			try {
				entry = JSON.parse(line.toString("utf8"));
			} catch {
				throw new Error(
					"Saved notes are being updated. Retry after the session settles.",
				);
			}
			if (Check(SessionHeader, entry)) {
				threadId = entry.id;
				continue;
			}
			if (!Check(RecordHeader, entry))
				throw new Error("Invalid saved session record");
			if (target === undefined) target = entry.id;
			const active = entry.id === target;
			if (active) target = entry.parentId;
			if (history) {
				entries.push(entry as SessionEntry);
				if (active) branch.push(entry as SessionEntry);
				continue;
			}
			if (Check(Custom, entry)) {
				if (SHARING_ENTRIES.has(entry.customType)) entries.push(entry);
				else if (active && NOTE_ENTRIES.has(entry.customType))
					branch.push(entry);
				else continue;
			} else if (
				active &&
				history &&
				(entry.type === "message" || entry.type === "custom_message")
			)
				branch.push(entry as SessionEntry);
			else if (active && Check(Handoff, entry)) branch.push(entry);
			else continue;
		}
		const after = await file.stat();
		if (before.size !== after.size || before.mtimeMs !== after.mtimeMs)
			throw new Error("Saved notes changed during the read. Retry the lookup.");
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
