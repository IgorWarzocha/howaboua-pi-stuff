import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { NoteSnapshotData } from "./bridge.js";
import { canonicalPath, readNotes } from "./note-query.js";
import { type NoteRevision, NotesStore, type SessionRef } from "./store.js";

export { normalizeNoteParams, readNotes } from "./note-query.js";

export const NOTE_RECEIPT = "notes-compaction:note:v1";
export const CACHE_RECEIPT = "notes-compaction:cache:v1";
export interface NoteReceipt {
	protocol: 1;
	sessionId: string;
	windowId: string;
	runId: string;
	origin?: "routed";
	/** Model-invisible recovery snapshot follows native fork and branch projections. */
	revision: NoteRevision;
}

export function sessionRef(ctx: ExtensionContext): SessionRef {
	return {
		id: ctx.sessionManager.getSessionId(),
		file: ctx.sessionManager.getSessionFile(),
	};
}

export function sourceSessionIds(ctx: ExtensionContext): string[] {
	const ids = new Set([ctx.sessionManager.getSessionId()]);
	for (const entry of ctx.sessionManager.getBranch())
		if (
			entry.type === "custom" &&
			entry.customType === CACHE_RECEIPT &&
			entry.data &&
			typeof entry.data === "object" &&
			"protocol" in entry.data &&
			entry.data.protocol === 1 &&
			"sessionId" in entry.data &&
			typeof entry.data.sessionId === "string"
		)
			ids.add(entry.data.sessionId);
	return [...ids];
}

export function noteReceipt(data: unknown): NoteReceipt | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("protocol" in data) ||
		data.protocol !== 1 ||
		!("revision" in data)
	)
		return;
	const record = data as Partial<NoteReceipt>;
	const revision = record.revision;
	if (
		typeof record.sessionId !== "string" ||
		typeof record.windowId !== "string" ||
		typeof record.runId !== "string" ||
		(record.origin !== undefined && record.origin !== "routed") ||
		!revision ||
		typeof revision.id !== "string" ||
		typeof revision.path !== "string" ||
		typeof revision.text !== "string" ||
		!["replace", "append"].includes(revision.mode) ||
		!Number.isFinite(revision.createdAt) ||
		!Number.isFinite(revision.updatedAt)
	)
		return;
	return record as NoteReceipt;
}

function relativeLegacyPath(path: string): string {
	// Legacy canonical paths use the first notes component as the agent-root boundary.
	const components = path.split("/");
	const boundary = components.indexOf("notes");
	return components[0] === "" && components[1] === "root" && boundary > 1
		? components.slice(boundary + 1).join("/")
		: path;
}

function snapshotNotes(data: unknown, id: string): NoteRevision[] | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("protocol" in data) ||
		data.protocol !== 1 ||
		!("files" in data) ||
		!Array.isArray(data.files)
	)
		return;
	const result: NoteRevision[] = [];
	for (const file of data.files) {
		if (
			!file ||
			typeof file !== "object" ||
			typeof file.path !== "string" ||
			typeof file.text !== "string" ||
			!Number.isFinite(file.createdAt) ||
			!Number.isFinite(file.updatedAt)
		)
			return;
		result.push({
			id,
			path: relativeLegacyPath(file.path),
			text: file.text,
			mode: file.operation === "local_append_overlay" ? "append" : "replace",
			createdAt: file.createdAt,
			updatedAt: file.updatedAt,
		});
	}
	return result;
}

/** Only selected-branch receipts choose visible revisions. Sibling writes never leak. */
export function collectNotes(
	store: Pick<NotesStore, "read">,
	entries: readonly SessionEntry[],
): Map<string, NoteRevision> {
	const notes = new Map<string, NoteRevision>();
	for (const entry of entries) {
		if (
			entry.type === "branch_summary" &&
			entry.details &&
			typeof entry.details === "object" &&
			"codexContextNoteHandoff" in entry.details
		) {
			for (const note of snapshotNotes(
				entry.details.codexContextNoteHandoff,
				entry.id,
			) ?? [])
				notes.set(note.path, note);
			continue;
		}
		if (entry.type !== "custom") continue;
		if (entry.customType === NOTE_RECEIPT) {
			const receipt = noteReceipt(entry.data);
			if (!receipt)
				throw new Error(
					"A saved note could not be read. Open an intact session branch to recover it.",
				);
			// A fork carries the receipt even when its source session was explicitly pruned.
			const revision = store.read(receipt.revision.id) ?? receipt.revision;
			notes.set(revision.path, revision);
		} else if (entry.customType === "codex-context-note") {
			const data = entry.data as
				| {
						protocol?: unknown;
						path?: unknown;
						text?: unknown;
						action?: unknown;
						timestamp?: unknown;
				  }
				| undefined;
			if (
				data?.protocol !== 1 ||
				typeof data.path !== "string" ||
				typeof data.text !== "string" ||
				(data.action !== "write" && data.action !== "append")
			)
				continue;
			const path = relativeLegacyPath(data.path);
			const previous = notes.get(path);
			const time = typeof data.timestamp === "number" ? data.timestamp : 0;
			notes.set(path, {
				id: entry.id,
				path,
				text:
					data.action === "append"
						? (previous?.text ?? "") + data.text
						: data.text,
				mode: "replace",
				createdAt: previous?.createdAt ?? time,
				updatedAt: time,
			});
		} else if (entry.customType === "codex-context-note-snapshot") {
			const snapshot = snapshotNotes(entry.data, entry.id);
			if (!snapshot) continue;
			notes.clear();
			for (const note of snapshot) notes.set(note.path, note);
		}
	}
	return notes;
}

/** Receipts carry recovery text, so detached reads need neither a database nor another process. */
export function exportNotesSnapshot(
	entries: readonly SessionEntry[],
	agentName: string,
): NoteSnapshotData {
	if (!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(agentName))
		throw new Error("Invalid notes agent identity");
	const notes = collectNotes({ read: () => undefined }, entries);
	const snapshot: NoteSnapshotData = {
		protocol: 1,
		timestamp: Date.now(),
		files: [...notes.values()]
			.sort((a, b) => a.path.localeCompare(b.path))
			.map((note) => ({
				path: `${agentName}/notes/${canonicalPath(note.path, agentName)}`,
				text: note.text,
				createdAt: note.createdAt,
				updatedAt: note.updatedAt,
				operation:
					note.mode === "append" ? "local_append_overlay" : "local_replacement",
			})),
	};
	if (
		snapshot.files.some((file) => Buffer.byteLength(file.text) > 1_000_000) ||
		Buffer.byteLength(JSON.stringify(snapshot)) > 10_000_000
	)
		throw new Error(
			"Notes snapshot exceeds the retained checkpoint size limit",
		);
	return snapshot;
}

export function noteHints(
	store: NotesStore,
	ctx: ExtensionContext,
	agent: string,
): string {
	const notes = [
		...collectNotes(store, ctx.sessionManager.getBranch()).values(),
	]
		.sort((a, b) => b.updatedAt - a.updatedAt)
		.map((note) => `${agent}/notes/${note.path}`);
	const paths = [
		...new Set([...notes, ...store.cachedPaths(sourceSessionIds(ctx))]),
	].slice(0, 5);
	return paths.length ? `Recent notes: ${paths.join(", ")}`.slice(0, 4000) : "";
}

export function useNotes(
	pi: ExtensionAPI,
	store: NotesStore,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	agent: string,
	windowId: string,
	runId: string,
	routed = false,
): Record<string, unknown> {
	const notes = collectNotes(store, ctx.sessionManager.getBranch());
	const action = params["action"];
	const root = `${agent}/notes/`;
	if (action === "write_file" || action === "append_to_file") {
		const path = params["path"] as string;
		const text = params["text"];
		if (typeof text !== "string")
			throw new Error(`notes ${action} requires text`);
		const previous = notes.get(path);
		const next =
			action === "append_to_file" ? (previous?.text ?? "") + text : text;
		if (Buffer.byteLength(next) > 1_000_000)
			throw new Error("Note file exceeds the 1,000,000-byte limit");
		const now = Date.now();
		// Append never pretends to decode a remote base. The remote fragment remains separate.
		const mode =
			action === "write_file" ? "replace" : (previous?.mode ?? "append");
		let revision: NoteRevision;
		try {
			revision = store.write(sessionRef(ctx), {
				path,
				text: next,
				mode,
				createdAt: previous?.createdAt ?? now,
				updatedAt: now,
			});
		} catch {
			throw new Error(
				"Local note could not be saved. The selected branch remains unchanged. Retry after local storage is available.",
			);
		}
		try {
			pi.appendEntry(NOTE_RECEIPT, {
				protocol: 1,
				sessionId: ctx.sessionManager.getSessionId(),
				windowId,
				runId,
				...(routed ? { origin: "routed" as const } : {}),
				revision,
			} satisfies NoteReceipt);
		} catch {
			throw new Error(
				`Note ${root}${path} was stored but not attached to this session. Read it before retrying the write.`,
			);
		}
		return {
			file: { path: `${root}${path}` },
		};
	}
	return readNotes(notes, params, agent);
}
