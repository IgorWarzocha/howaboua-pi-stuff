import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { useHistory } from "./history.js";
import type { HistorySearch } from "./history-search.js";
import { normalizeNoteParams, readNotes } from "./note-query.js";
import { collectNotes } from "./notes.js";
import {
	readSavedNotesSession,
	type SavedNotesSession,
} from "./saved-session.js";
import {
	type Identity,
	Snapshot,
	sameOwner,
	savedNotesIdentity,
} from "./saved-sharing-records.js";
import type { NotesStore } from "./store.js";

export function createSharedSessionReader(
	store: Pick<NotesStore, "read">,
	access:
		| { namespace: "notes" }
		| { namespace: "history"; search: HistorySearch },
	outputAgent: string,
	signal: AbortSignal | undefined,
	resolve: (
		session: SavedNotesSession,
		destination: string,
		query: Record<string, unknown>,
	) => Promise<Record<string, unknown> | undefined>,
) {
	const { namespace } = access;
	async function read(
		session: SavedNotesSession,
		query: Record<string, unknown>,
		native: string,
	) {
		return {
			...(access.namespace === "history"
				? await useHistory(
						session.branch,
						query,
						session.threadId,
						access.search,
						session.entries,
						signal,
					)
				: readNotes(
						collectNotes(store, session.branch),
						normalizeNoteParams(query, native),
						outputAgent,
					)),
			...(namespace === "notes"
				? {
						read_only: true,
						warning:
							"Only saved notes are included; other notes may be missing",
					}
				: {}),
			...(session.savedAt === undefined
				? {}
				: { saved_at: new Date(session.savedAt).toISOString() }),
		};
	}
	async function reference(
		identity: Identity,
		destination: string,
		query: Record<string, unknown>,
		file: string | undefined,
		retained?: unknown,
		detached = false,
	): Promise<Record<string, unknown> | undefined> {
		if (file && (!detached || namespace === "history")) {
			let saved: SavedNotesSession | undefined;
			try {
				saved = await readSavedNotesSession(
					file,
					signal,
					namespace === "history",
				);
			} catch (error) {
				signal?.throwIfAborted();
				if (
					!(
						error instanceof Error &&
						"code" in error &&
						error.code === "ENOENT" &&
						retained !== undefined &&
						namespace === "notes"
					)
				)
					throw error;
			}
			if (saved) {
				if (!sameOwner(savedNotesIdentity(saved), identity))
					throw new Error("Saved shared notes belong to a different session");
				return resolve(saved, destination, query);
			}
		}
		if (
			namespace === "history" ||
			destination !== identity.agentName ||
			!Check(Snapshot, retained)
		)
			return;
		const entry: SessionEntry = {
			type: "custom",
			id: "retained",
			parentId: null,
			timestamp: new Date(retained.timestamp).toISOString(),
			customType: "codex-context-note-snapshot",
			data: {
				...retained,
				files: retained.files.filter((file) =>
					file.path.startsWith(`${identity.agentName}/notes/`),
				),
			},
		};
		return {
			...(await read(
				{ threadId: identity.threadId, entries: [], branch: [entry] },
				query,
				identity.agentName,
			)),
			captured_at: new Date(retained.timestamp).toISOString(),
			warning: detached
				? "Read-only notes captured when sharing ended; later changes are not included"
				: "The latest notes are unavailable; this read-only copy may be outdated",
		};
	}
	return { read, reference };
}
