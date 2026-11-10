import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";

export { readSavedNotesSession } from "./saved-session.mjs";
export interface SavedNotesSession {
	threadId: string;
	entries: readonly SessionEntry[];
	branch: readonly SessionEntry[];
	savedAt?: number;
}

const SavedEntry = Type.Object({
	type: Type.String(),
	id: Type.String(),
	parentId: Type.Union([Type.String(), Type.Null()]),
	timestamp: Type.String(),
});
const SavedSession = Type.Object({
	threadId: Type.String({ minLength: 1 }),
	entries: Type.Array(SavedEntry),
	branch: Type.Array(SavedEntry),
	savedAt: Type.Optional(Type.Number()),
});

/** Remote loaders carry data, not authority. Native identity is checked by the graph reader. */
export function validateSavedNotesSession(value: unknown): SavedNotesSession {
	if (!Check(SavedSession, value))
		throw new Error(
			"Saved session response is invalid. Update Notes on the other machine and retry.",
		);
	for (const entry of [...value.entries, ...value.branch]) {
		if (
			entry.type === "custom" &&
			(!("customType" in entry) ||
				typeof entry.customType !== "string" ||
				!("data" in entry))
		)
			throw new Error("Invalid saved session custom record");
		if (
			entry.type === "message" &&
			(!("message" in entry) ||
				!entry.message ||
				typeof entry.message !== "object")
		)
			throw new Error("Invalid saved session message record");
	}
	// The same persisted entry envelope is accepted by the Node reader. Feature readers
	// validate their own custom data, including ownership and note receipts.
	return value as SavedNotesSession;
}
