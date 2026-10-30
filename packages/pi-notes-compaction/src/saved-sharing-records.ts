import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import type { SavedNotesSession } from "./saved-session.js";

const Agent = Type.String({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" });
export const Identity = Type.Object({
	protocol: Type.Literal(1),
	sessionId: Type.String(),
	threadId: Type.String(),
	agentName: Agent,
	storage: Type.Optional(
		Type.Union([Type.Literal("session"), Type.Literal("remote")]),
	),
	routing: Type.Optional(Type.Unknown()),
});
export const Member = Type.Object({
	threadId: Type.String(),
	sessionId: Type.String(),
	agentName: Agent,
	machine: Type.String(),
	sessionFile: Type.String(),
});
export const Plan = Type.Object({
	controllerSessionId: Type.String(),
	targetSessionId: Type.String(),
	context: Type.Optional(
		Type.Object({
			controller: Identity,
			target: Identity,
			alias: Agent,
			controllerAlias: Agent,
			controllerFile: Type.Optional(Type.String()),
			controllerNotes: Type.Unknown(),
			targetNotes: Type.Unknown(),
		}),
	),
});
export const Route = Type.Object({
	plan: Plan,
	machine: Type.String(),
	sessionFile: Type.String(),
	phase: Type.Union([Type.Literal("pending"), Type.Literal("ready")]),
	detached: Type.Optional(
		Type.Object({ context: Type.Optional(Type.Unknown()) }),
	),
});
export const Detachment = Type.Object({
	plan: Plan,
	context: Type.Optional(Type.Unknown()),
});
export const Snapshot = Type.Object({
	protocol: Type.Literal(1),
	timestamp: Type.Number(),
	files: Type.Array(
		Type.Object({
			path: Type.String(),
			text: Type.String(),
			createdAt: Type.Number(),
			updatedAt: Type.Number(),
			operation: Type.Union([
				Type.Literal("local_append_overlay"),
				Type.Literal("local_replacement"),
			]),
		}),
	),
});
export const Parent = Type.Object({
	transport: Type.Literal("shepherdr"),
	parent: Type.String(),
});
export type Identity = Static<typeof Identity>;

/** Persisted sharing is session-scoped. Forks never inherit the source agent's address. */
export function savedNotesIdentity(
	session: Pick<SavedNotesSession, "threadId" | "entries">,
): Identity {
	let found: Identity | undefined;
	for (const entry of session.entries) {
		if (entry.type !== "custom" || entry.customType !== "codex-context-agent")
			continue;
		if (!Check(Identity, entry.data))
			throw new Error("Invalid saved notes identity");
		if (entry.data.threadId !== session.threadId) continue;
		if (found) throw new Error("Conflicting saved notes identities");
		found = entry.data;
	}
	return (
		found ?? {
			protocol: 1,
			threadId: session.threadId,
			sessionId: session.threadId,
			agentName: "/root",
		}
	);
}

export function sameOwner(a: Identity, b: Identity): boolean {
	return (
		a.threadId === b.threadId &&
		a.sessionId === b.sessionId &&
		a.agentName === b.agentName
	);
}
