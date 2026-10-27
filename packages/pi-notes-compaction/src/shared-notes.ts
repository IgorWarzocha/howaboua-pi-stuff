import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { useHistory } from "./history.js";
import type { HistorySearch } from "./history-search.js";
import { collectNotes, normalizeNoteParams, readNotes } from "./notes.js";
import {
	readSavedNotesSession,
	type SavedNotesSession,
} from "./saved-session.js";
import type { NotesStore } from "./store.js";

const Agent = Type.String({ pattern: "^/root(?:/[a-zA-Z0-9_-]+)*$" });
const Identity = Type.Object({
	protocol: Type.Literal(1),
	sessionId: Type.String(),
	threadId: Type.String(),
	agentName: Agent,
	storage: Type.Optional(
		Type.Union([Type.Literal("session"), Type.Literal("remote")]),
	),
	routing: Type.Optional(Type.Unknown()),
});
const Member = Type.Object({
	threadId: Type.String(),
	sessionId: Type.String(),
	agentName: Agent,
	machine: Type.String(),
	sessionFile: Type.String(),
});
const Plan = Type.Object({
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
const Route = Type.Object({
	plan: Plan,
	machine: Type.String(),
	sessionFile: Type.String(),
	phase: Type.Union([Type.Literal("pending"), Type.Literal("ready")]),
	detached: Type.Optional(
		Type.Object({ context: Type.Optional(Type.Unknown()) }),
	),
});
const Detachment = Type.Object({
	plan: Plan,
	context: Type.Optional(Type.Unknown()),
});
const Snapshot = Type.Object({
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
const Parent = Type.Object({
	transport: Type.Literal("shepherdr"),
	parent: Type.String(),
});
type Identity = Static<typeof Identity>;

function records(session: SavedNotesSession, kind: string): unknown[] {
	return session.entries.flatMap((entry) =>
		entry.type === "custom" && entry.customType === kind ? [entry.data] : [],
	);
}

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

function sameOwner(a: Identity, b: Identity): boolean {
	return (
		a.threadId === b.threadId &&
		a.sessionId === b.sessionId &&
		a.agentName === b.agentName
	);
}
function inside(path: string, root: string): boolean {
	return path === root || path.startsWith(`${root}/`);
}
function remap(
	params: Record<string, unknown>,
	from: string,
	to: string,
): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(params).map(([key, value]) => [
			key,
			["path", "prefix", "path_prefix"].includes(key) &&
			typeof value === "string" &&
			inside(value, from)
				? `${to}${value.slice(from.length)}`
				: value,
		]),
	);
}

export function sharedNotesUnavailable(error: unknown): boolean {
	return (
		error instanceof Error &&
		/^(Cross-agent (?:context requires an available context router|notes (?:are unavailable here|owner is unavailable))|Shared context (?:owner|controller) is unavailable|Shared context response was lost|Herdr machine .* is (?:unavailable|disconnected)|remote Shepherdr bridge (?:is unavailable|closed|exited\b)|remote Shepherdr context timed out)/.test(
			error.message,
		)
	);
}

/** Saved local notes do not need PCC, a router, or a running owner. Writes still belong to the live session. */
export async function readSharedNotes(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read">,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
	return readSharedSession(ctx, store, params, { namespace: "notes" }, signal);
}

export async function readSharedHistory(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read">,
	search: HistorySearch,
	params: Record<string, unknown>,
	signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
	return readSharedSession(
		ctx,
		store,
		params,
		{ namespace: "history", search },
		signal,
	);
}

async function readSharedSession(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read">,
	params: Record<string, unknown>,
	access:
		| { namespace: "notes" }
		| { namespace: "history"; search: HistorySearch },
	signal?: AbortSignal,
): Promise<Record<string, unknown> | undefined> {
	const { namespace } = access;
	if (
		namespace === "notes" &&
		!["read_file", "list_files_by_prefix", "search_contents"].includes(
			String(params["action"]),
		)
	)
		return;
	const path =
		namespace === "history"
			? params["agent_name"]
			: (params["path"] ?? params["prefix"] ?? params["path_prefix"]);
	if (typeof path !== "string" || !path.startsWith("/")) return;
	const target =
		namespace === "history"
			? /^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(path)
				? path
				: undefined
			: /^(\/root(?:\/[a-zA-Z0-9_-]+)*?)\/notes(?:\/|$)/.exec(path)?.[1];
	if (!target) return;
	const outputAgent = target;
	const current: SavedNotesSession = {
		threadId: ctx.sessionManager.getSessionId(),
		entries: ctx.sessionManager.getEntries(),
		branch: ctx.sessionManager.getBranch(),
	};
	if (savedNotesIdentity(current).agentName === target) return;
	const visited = new Set<string>();

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
	async function resolve(
		session: SavedNotesSession,
		destination: string,
		query: Record<string, unknown>,
	): Promise<Record<string, unknown> | undefined> {
		signal?.throwIfAborted();
		if (visited.has(session.threadId)) return;
		visited.add(session.threadId);
		const identity = savedNotesIdentity(session);
		if (identity.agentName === destination) {
			if (
				namespace === "notes" &&
				identity.storage === "remote" &&
				!session.branch.some(
					(entry) =>
						entry.type === "custom" &&
						entry.customType === "notes-compaction:note:v1",
				)
			)
				return;
			return read(session, query, identity.agentName);
		}
		const routes = new Map<string, Static<typeof Route>>();
		for (const value of records(session, "shepherdr-attachment-route"))
			if (
				Check(Route, value) &&
				value.plan.controllerSessionId === identity.threadId
			)
				routes.set(`${value.machine}\0${value.sessionFile}`, value);
		for (const route of routes.values()) {
			const link = route.plan.context;
			if (route.phase !== "ready" || !link || !inside(destination, link.alias))
				continue;
			if (!sameOwner(identity, link.controller))
				throw new Error("Saved shared notes identity changed");
			return reference(
				link.target,
				`${link.target.agentName}${destination.slice(link.alias.length)}`,
				remap(query, link.alias, link.target.agentName),
				route.machine === "local" ? route.sessionFile : undefined,
				route.detached?.context ?? link.targetNotes,
				route.detached?.context !== undefined,
			);
		}
		const owner = records(session, "shepherdr-attachment-owner").findLast(
			(value) =>
				Check(Plan, value) && value.targetSessionId === identity.threadId,
		);
		if (
			Check(Plan, owner) &&
			owner.context &&
			inside(destination, owner.context.controllerAlias)
		) {
			const link = owner.context;
			if (!sameOwner(identity, link.target))
				throw new Error("Saved shared notes identity changed");
			const detached = records(
				session,
				"shepherdr-attachment-detached",
			).findLast(
				(value) =>
					Check(Detachment, value) && isDeepStrictEqual(value.plan, owner),
			);
			const snapshot = Check(Detachment, detached)
				? detached.context
				: undefined;
			return reference(
				link.controller,
				`${link.controller.agentName}${destination.slice(link.controllerAlias.length)}`,
				remap(query, link.controllerAlias, link.controller.agentName),
				link.controllerFile,
				snapshot ?? link.controllerNotes,
				snapshot !== undefined,
			);
		}
		const member = records(session, "herdr-context-child").findLast(
			(value) =>
				Check(Member, value) &&
				value.threadId === identity.threadId &&
				value.sessionId === identity.sessionId &&
				inside(destination, value.agentName),
		);
		if (Check(Member, member)) {
			if (member.machine !== "local") return;
			const saved = await readSavedNotesSession(
				member.sessionFile,
				signal,
				namespace === "history",
			);
			const child = savedNotesIdentity(saved);
			if (
				child.sessionId !== identity.sessionId ||
				child.agentName !== member.agentName
			)
				throw new Error(
					"Saved shared notes belong to a different agent family",
				);
			return resolve(saved, destination, query);
		}
		const routing = identity.routing;
		const suffix = ".jsonl.shepherdr-context.json";
		if (Check(Parent, routing) && routing.parent.endsWith(suffix)) {
			const saved = await readSavedNotesSession(
				routing.parent.slice(0, -".shepherdr-context.json".length),
				signal,
				namespace === "history",
			);
			const parent = savedNotesIdentity(saved);
			if (
				parent.sessionId !== identity.sessionId ||
				!identity.agentName.startsWith(`${parent.agentName}/`)
			)
				throw new Error("Saved shared notes parent identity changed");
			return resolve(saved, destination, query);
		}
		return undefined;
	}
	try {
		return await resolve(current, target, params);
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			["ENOENT", "EACCES", "EPERM"].includes(String(error.code))
		)
			throw new Error(
				`Saved shared ${namespace} are unavailable on this machine. Restore access to the saved Pi JSONL session, then retry.`,
				{ cause: error },
			);
		throw error;
	}
}
