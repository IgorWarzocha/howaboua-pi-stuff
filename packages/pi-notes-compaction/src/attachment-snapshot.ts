import { Type } from "typebox";
import { Check } from "typebox/value";
import type { RemoteNoteReference } from "./context-sharing.js";
import { normalizeNoteParams, readNotes } from "./notes.js";
import type { NoteRevision } from "./store.js";

const Snapshot = Type.Object({
	protocol: Type.Literal(1),
	timestamp: Type.Number({ minimum: 0 }),
	files: Type.Array(
		Type.Object({
			path: Type.String(),
			text: Type.String(),
			createdAt: Type.Number(),
			updatedAt: Type.Number(),
			operation: Type.Optional(
				Type.Union([
					Type.Literal("local_append_overlay"),
					Type.Literal("local_replacement"),
				]),
			),
		}),
	),
});

/** Retained checkpoints remain readable without a running owner or database. */
export function readAttachmentSnapshot(
	snapshot: unknown,
	params: Record<string, unknown>,
): Record<string, unknown> {
	if (!Check(Snapshot, snapshot))
		throw new Error("Invalid retained note snapshot");
	if (
		!["list_files_by_prefix", "read_file", "search_contents"].includes(
			String(params["action"]),
		)
	)
		throw new Error(
			"Retained checkpoints are read-only; resume the attached owner to write notes",
		);
	const path = params["path"] ?? params["prefix"] ?? params["path_prefix"];
	const agent =
		typeof path === "string"
			? (/^(\/root(?:\/[a-zA-Z0-9_-]+)*?)\/notes(?:\/|$)/.exec(path)?.[1] ??
				"/root")
			: "/root";
	const notes = new Map<string, NoteRevision>();
	for (const file of snapshot.files) {
		if (!/^\/root(?:\/[a-zA-Z0-9_-]+)*?\/notes\/.+/.test(file.path))
			throw new Error("Invalid retained note path");
		if (!file.path.startsWith(`${agent}/notes/`)) continue;
		const local = file.path.slice(`${agent}/notes/`.length);
		notes.set(local, {
			...file,
			path: local,
			id: file.path,
			mode: file.operation === "local_append_overlay" ? "append" : "replace",
		});
	}
	return readNotes(notes, normalizeNoteParams(params, agent), agent);
}

export function readRemoteNoteReference(input: unknown): RemoteNoteReference {
	if (
		!input ||
		typeof input !== "object" ||
		!("protocol" in input) ||
		input.protocol !== 1 ||
		!("storage" in input) ||
		input.storage !== "remote" ||
		!("timestamp" in input) ||
		typeof input.timestamp !== "number" ||
		!Number.isFinite(input.timestamp) ||
		input.timestamp < 0 ||
		!("baseUrl" in input) ||
		typeof input.baseUrl !== "string" ||
		!input.baseUrl ||
		input.baseUrl.length > 8192 ||
		!("identity" in input) ||
		!input.identity ||
		typeof input.identity !== "object"
	)
		throw new Error("Invalid Remote checkpoint reference");
	const identity = input.identity as Partial<RemoteNoteReference["identity"]>;
	if (
		identity.protocol !== 1 ||
		identity.storage !== "remote" ||
		typeof identity.threadId !== "string" ||
		!identity.threadId ||
		identity.threadId.length > 512 ||
		typeof identity.sessionId !== "string" ||
		!identity.sessionId ||
		identity.sessionId.length > 512 ||
		typeof identity.agentName !== "string" ||
		identity.agentName.length > 4096 ||
		!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(identity.agentName) ||
		typeof identity.accountScope !== "string" ||
		!/^[a-f0-9]{64}$/.test(identity.accountScope) ||
		identity.backendUrl !== input.baseUrl
	)
		throw new Error("Invalid Remote checkpoint identity");
	return input as RemoteNoteReference;
}
