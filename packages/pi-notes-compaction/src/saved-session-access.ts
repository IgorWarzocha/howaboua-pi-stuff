import { Type } from "typebox";
import { Check } from "typebox/value";
import type {
	SavedSessionLoader,
	SavedSessionLocator,
} from "./context-sharing.js";
import {
	readSavedNotesSession,
	type SavedNotesSession,
	validateSavedNotesSession,
} from "./saved-session.js";
import { savedFamilyIdentity } from "./saved-sharing-records.js";
import type { NotesStore } from "./store.js";

const Locations = Type.Array(
	Type.Object({
		machine: Type.String({ minLength: 1 }),
		sessionFile: Type.String({ minLength: 1 }),
	}),
);

/** Local is relative to the session carrying the edge, not the machine running this reader. */
export function createSavedSessionAccess(
	store: Pick<NotesStore, "sessionFile">,
	namespace: "notes" | "history",
	loader: SavedSessionLoader | undefined,
	signal: AbortSignal | undefined,
) {
	const locations = new WeakMap<SavedNotesSession, SavedSessionLocator>();
	const containingMachine = (session: SavedNotesSession) =>
		locations.get(session)?.machine ?? "local";
	function locator(
		session: SavedNotesSession,
		machine: string,
		sessionFile: string,
	): SavedSessionLocator {
		return {
			machine: machine === "local" ? containingMachine(session) : machine,
			sessionFile,
		};
	}
	async function load(
		location: SavedSessionLocator,
	): Promise<SavedNotesSession> {
		signal?.throwIfAborted();
		const session =
			location.machine === "local"
				? await readSavedNotesSession(
						location.sessionFile,
						signal,
						namespace === "history",
					)
				: loader
					? validateSavedNotesSession(
							await loader(location, namespace === "history", signal),
						)
					: (() => {
							throw Object.assign(
								new Error(
									"Saved shared sessions on that machine are unavailable. Resume the shared agent and reconnect its machine, or make its saved Pi JSONL session available locally.",
								),
								{ code: "SAVED_SESSION_UNAVAILABLE" },
							);
						})();
		locations.set(session, location);
		return session;
	}

	async function indexed(
		current: SavedNotesSession,
		target: string,
	): Promise<SavedNotesSession | undefined> {
		// An exact local hint avoids dead relay parents. Index rows never establish membership.
		const family = savedFamilyIdentity(current);
		const threadId = target.slice(1);
		if (family && !threadId.includes("/") && target !== "/root") {
			const file = store.sessionFile(threadId);
			if (file) {
				const saved = await load({ machine: "local", sessionFile: file });
				const member = savedFamilyIdentity(saved);
				if (
					saved.threadId !== threadId ||
					!member ||
					member.storage !== "session" ||
					member.sessionId !== family.sessionId ||
					member.agentName !== target
				)
					throw new Error(
						"Saved shared notes belong to a different agent family",
					);
				return saved;
			}
		}
		return;
	}
	async function find(target: string): Promise<SavedSessionLocator[]> {
		const threadId = target.slice(1);
		if (!loader?.find || target === "/root" || threadId.includes("/"))
			return [];
		signal?.throwIfAborted();
		const value = await loader.find(threadId, signal);
		signal?.throwIfAborted();
		if (!Check(Locations, value))
			throw new Error(
				"Saved session discovery response is invalid. Update Notes on the other machine and retry.",
			);
		return [
			...new Map(
				value.map((location) => [
					`${location.machine}\0${location.sessionFile}`,
					location,
				]),
			).values(),
		];
	}
	return { containingMachine, locator, load, indexed, find };
}
