import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Check } from "typebox/value";
import { minuteTimestamp } from "../timestamps.js";
import { contextStorageAgentName } from "./agent-identity.js";
import type { SavedSessionLocator } from "./context-sharing.js";
import { useHistory } from "./history.js";
import type { HistorySearch } from "./history-search.js";
import { normalizeNoteParams, readNotes } from "./note-query.js";
import { collectNotes } from "./notes.js";
import { type SavedNotesSession } from "./saved-session.js";
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
	load: (locator: SavedSessionLocator) => Promise<SavedNotesSession>,
	resolve: (
		session: SavedNotesSession,
		destination: string,
		query: Record<string, unknown>,
	) => Promise<Record<string, unknown> | undefined>,
	unavailable: (error: unknown) => boolean,
) {
	const { namespace } = access;
	async function read(
		session: SavedNotesSession,
		query: Record<string, unknown>,
		native: string,
	): Promise<Record<string, unknown> | undefined> {
		if (namespace === "notes") {
			const normalized = normalizeNoteParams(query, native);
			const replacement =
				normalized["action"] === "read_file" &&
				collectNotes(store, session.branch).get(String(normalized["path"]))
					?.mode === "replace";
			// Never replace a merged hybrid read with a local-only saved branch.
			if (
				!replacement &&
				(savedNotesIdentity(session).storage === "remote" ||
					session.branch.some(
						(entry) =>
							entry.type === "custom" &&
							entry.customType === "notes-compaction:cache:v1",
					))
			)
				return;
		}
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
			...(session.savedAt === undefined
				? {}
				: { saved_at: minuteTimestamp(session.savedAt) }),
		};
	}
	async function reference(
		identity: Identity,
		destination: string,
		query: Record<string, unknown>,
		locator: SavedSessionLocator | undefined,
		retained?: unknown,
		detached = false,
	): Promise<Record<string, unknown> | undefined> {
		if (locator && (!detached || namespace === "history")) {
			let saved: SavedNotesSession | undefined;
			try {
				saved = await load(locator);
			} catch (error) {
				signal?.throwIfAborted();
				if (
					!(
						unavailable(error) &&
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
			(destination !== identity.agentName &&
				destination !== contextStorageAgentName(identity)) ||
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
				files: retained.files.filter(
					(file) =>
						file.path.startsWith(`${identity.agentName}/notes/`) ||
						file.path.startsWith(`${contextStorageAgentName(identity)}/notes/`),
				),
			},
		};
		return {
			...(await read(
				{ threadId: identity.threadId, entries: [], branch: [entry] },
				query,
				destination,
			)),
			read_only: true,
			captured_at: minuteTimestamp(retained.timestamp),
			warning: detached
				? "Read-only notes captured when sharing ended; later changes are not included"
				: "The latest notes are unavailable; this read-only copy may be outdated",
		};
	}
	return { read, reference };
}
