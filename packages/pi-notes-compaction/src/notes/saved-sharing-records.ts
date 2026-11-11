import {
	arr,
	compile,
	lit,
	num,
	obj,
	opt,
	type Static,
	str,
	union,
	unknown,
} from "@earendil-works/pi-schema";
import {
	CONTEXT_AGENT_PATTERN,
	canonicalAgentName,
	canonicalContextIdentity,
	contextStorageAgentName,
	pinnedContextIdentity,
} from "./agent-identity.js";
import type { SavedNotesSession } from "./saved-session.js";

const Agent = str({ pattern: CONTEXT_AGENT_PATTERN });
export const Identity = obj(
	{
		protocol: lit(1),
		sessionId: str(),
		threadId: str(),
		agentName: Agent,
		storageAgentName: opt(Agent),
		storage: opt(union([lit("session"), lit("remote")])),
		routing: opt(unknown()),
	},
	{ open: true },
);
export const Member = obj(
	{
		threadId: str(),
		sessionId: str(),
		agentName: Agent,
		machine: str(),
		sessionFile: str(),
	},
	{ open: true },
);
export const Plan = obj(
	{
		controllerSessionId: str(),
		targetSessionId: str(),
		context: opt(
			obj(
				{
					controller: Identity,
					target: Identity,
					alias: Agent,
					controllerAlias: Agent,
					controllerFile: opt(str()),
					controllerMachine: opt(str()),
					controllerNotes: unknown(),
					targetNotes: unknown(),
				},
				{ open: true },
			),
		),
	},
	{ open: true },
);
export const Route = obj(
	{
		plan: Plan,
		machine: str(),
		sessionFile: str(),
		phase: union([lit("pending"), lit("ready")]),
		detached: opt(obj({ context: opt(unknown()) }, { open: true })),
	},
	{ open: true },
);
export const Detachment = obj(
	{
		plan: Plan,
		context: opt(unknown()),
	},
	{ open: true },
);
export const Snapshot = obj(
	{
		protocol: lit(1),
		timestamp: num(),
		files: arr(
			obj(
				{
					path: str(),
					text: str(),
					createdAt: num(),
					updatedAt: num(),
					operation: union([
						lit("local_append_overlay"),
						lit("local_replacement"),
					]),
				},
				{ open: true },
			),
		),
	},
	{ open: true },
);
export const Parent = obj(
	{
		transport: lit("shepherdr"),
		parent: str(),
		savedParent: opt(
			obj({ machine: str(), sessionFile: str() }, { open: true }),
		),
	},
	{ open: true },
);
export type Identity = Static<typeof Identity>;

const identityValidator = compile(Identity);

/** Ordinary family membership is immutable, explicit and native-session owned. */
export function savedFamilyIdentity(
	session: Pick<SavedNotesSession, "threadId" | "entries">,
): Identity | undefined {
	const identity = savedNotesIdentity(session);
	if (
		identity.storage === undefined ||
		!session.entries.some(
			(entry) =>
				entry.type === "custom" &&
				entry.customType === "codex-context-agent" &&
				identityValidator.check(entry.data) &&
				entry.data.threadId === session.threadId,
		)
	)
		return;
	return identity;
}

/** Persisted sharing is session-scoped. Forks never inherit the source agent's address. */
export function savedNotesIdentity(
	session: Pick<SavedNotesSession, "threadId" | "entries">,
): Identity {
	let found: Identity | undefined;
	for (const entry of session.entries) {
		if (entry.type !== "custom" || entry.customType !== "codex-context-agent")
			continue;
		if (!identityValidator.check(entry.data))
			throw new Error("Invalid saved notes identity");
		if (entry.data.threadId !== session.threadId) continue;
		if (found) throw new Error("Conflicting saved notes identities");
		found = entry.data;
	}
	return canonicalContextIdentity(
		found ??
			pinnedContextIdentity(session.threadId, session.entries) ?? {
				protocol: 1,
				threadId: session.threadId,
				sessionId: session.threadId,
				agentName: canonicalAgentName(session.threadId),
			},
	);
}

export function sameOwner(a: Identity, b: Identity): boolean {
	return (
		a.threadId === b.threadId &&
		a.sessionId === b.sessionId &&
		contextStorageAgentName(a) === contextStorageAgentName(b)
	);
}
