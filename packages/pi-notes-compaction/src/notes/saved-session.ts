import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	arr,
	compile,
	nul,
	num,
	obj,
	opt,
	str,
	union,
} from "@earendil-works/pi-schema";

export { readSavedNotesSession } from "./saved-session.mjs";
export interface SavedNotesSession {
	threadId: string;
	entries: readonly SessionEntry[];
	branch: readonly SessionEntry[];
	savedAt?: number;
}

const SavedEntry = obj(
	{
		type: str(),
		id: str(),
		parentId: union([str(), nul()]),
		timestamp: str(),
	},
	{ open: true },
);
const SavedSession = obj(
	{
		threadId: str({ minLength: 1 }),
		entries: arr(SavedEntry),
		branch: arr(SavedEntry),
		savedAt: opt(num()),
	},
	{ open: true },
);

const savedSessionValidator = compile(SavedSession);

/** Remote loaders carry data, not authority. Native identity is checked by the graph reader. */
export function validateSavedNotesSession(value: unknown): SavedNotesSession {
	if (!savedSessionValidator.check(value))
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
