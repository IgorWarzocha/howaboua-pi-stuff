// @howaboua/pi-shepherdr managed bridge
import { isDeepStrictEqual } from "node:util";

/** @param {unknown} identity */
function canonicalIdentity(identity) {
	if (
		!identity ||
		typeof identity !== "object" ||
		!("threadId" in identity) ||
		typeof identity.threadId !== "string" ||
		!("agentName" in identity) ||
		typeof identity.agentName !== "string" ||
		("storageAgentName" in identity &&
			typeof identity.storageAgentName !== "string")
	)
		throw new Error("Saved checkpoint owner identity changed");
	const agentName = `/${identity.threadId}`;
	return identity.agentName === agentName
		? identity
		: {
				...identity,
				agentName,
				storageAgentName:
					"storageAgentName" in identity
						? identity.storageAgentName
						: identity.agentName,
			};
}

/** @param {string} path @param {{protocol: 1, threadId: string, sessionId: string, agentName: string, storageAgentName?: string, storage: "session"}} identity */
export async function readPersistedNoteEntries(path, identity) {
	const { readSavedNotesSession } = await import("./notes-reader.mjs");
	const saved = await readSavedNotesSession(path);
	if (saved.threadId !== identity.threadId)
		throw new Error("Saved checkpoint owner identity changed");
	const identities = saved.entries.flatMap((entry) =>
		entry.type === "custom" &&
		entry.customType === "codex-context-agent" &&
		entry.data &&
		typeof entry.data === "object" &&
		"threadId" in entry.data &&
		entry.data.threadId === identity.threadId
			? [entry.data]
			: [],
	);
	if (!identities.length)
		throw new Error("Saved checkpoint owner identity is unavailable");
	if (
		identities.length !== 1 ||
		!isDeepStrictEqual(
			canonicalIdentity(identities[0]),
			canonicalIdentity(identity),
		)
	)
		throw new Error("Saved checkpoint owner identity changed");
	const snapshot = saved.branch.findLastIndex(
		(entry) =>
			entry.type === "custom" &&
			entry.customType === "codex-context-note-snapshot",
	);
	const entries = saved.branch.slice(Math.max(0, snapshot));
	if (Buffer.byteLength(JSON.stringify(entries)) > 7 * 1024 * 1024)
		throw new Error("Saved checkpoints exceed the transport limit");
	return { entries, savedAt: saved.savedAt };
}
