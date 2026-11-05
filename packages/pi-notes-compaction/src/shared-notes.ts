import { isDeepStrictEqual } from "node:util";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Static } from "typebox";
import { Check } from "typebox/value";
import {
	canonicalAgentName,
	contextAgentNames,
	contextStorageAgentName,
	contextTargetAgent,
	isContextAgentName,
} from "./agent-identity.js";
import type { HistorySearch } from "./history-search.js";
import {
	readSavedNotesSession,
	type SavedNotesSession,
} from "./saved-session.js";
import {
	Detachment,
	Member,
	Parent,
	Plan,
	Route,
	sameOwner,
	savedNotesIdentity,
} from "./saved-sharing-records.js";
import { createSharedSessionReader } from "./shared-session-reader.js";
import type { NotesStore } from "./store.js";

export { savedNotesIdentity } from "./saved-sharing-records.js";

function records(session: SavedNotesSession, kind: string): unknown[] {
	return session.entries.flatMap((entry) =>
		entry.type === "custom" && entry.customType === kind ? [entry.data] : [],
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
			? isContextAgentName(path)
				? path
				: undefined
			: contextTargetAgent(
					"notes",
					{ path },
					canonicalAgentName(ctx.sessionManager.getSessionId()),
				);
	if (!target) return;
	const outputAgent = target;
	const current: SavedNotesSession = {
		threadId: ctx.sessionManager.getSessionId(),
		entries: ctx.sessionManager.getEntries(),
		branch: ctx.sessionManager.getBranch(),
	};
	if (contextAgentNames(savedNotesIdentity(current)).includes(target)) return;
	const visited = new Set<string>();

	const { read, reference } = createSharedSessionReader(
		store,
		access,
		outputAgent,
		signal,
		resolve,
	);
	async function resolve(
		session: SavedNotesSession,
		destination: string,
		query: Record<string, unknown>,
	): Promise<Record<string, unknown> | undefined> {
		signal?.throwIfAborted();
		if (visited.has(session.threadId)) return;
		visited.add(session.threadId);
		const identity = savedNotesIdentity(session);
		if (contextAgentNames(identity).includes(destination)) {
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
			return read(session, query, destination);
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
			if (route.phase !== "ready" || !link) continue;
			const alias =
				destination === canonicalAgentName(link.target.threadId)
					? destination
					: link.alias;
			if (!inside(destination, alias)) continue;
			if (!sameOwner(identity, link.controller))
				throw new Error("Saved shared notes identity changed");
			return reference(
				link.target,
				`${link.target.agentName}${destination.slice(alias.length)}`,
				remap(query, alias, link.target.agentName),
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
			(inside(destination, owner.context.controllerAlias) ||
				destination === canonicalAgentName(owner.context.controller.threadId))
		) {
			const link = owner.context;
			const alias =
				destination === canonicalAgentName(link.controller.threadId)
					? destination
					: link.controllerAlias;
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
				`${link.controller.agentName}${destination.slice(alias.length)}`,
				remap(query, alias, link.controller.agentName),
				link.controllerFile,
				snapshot ?? link.controllerNotes,
				snapshot !== undefined,
			);
		}
		const members = records(session, "herdr-context-child").filter(
			(value) =>
				Check(Member, value) &&
				value.threadId === identity.threadId &&
				value.sessionId === identity.sessionId,
		);
		for (const member of members) {
			if (!Check(Member, member) || member.machine !== "local") continue;
			const saved = await readSavedNotesSession(
				member.sessionFile,
				signal,
				namespace === "history",
			);
			const child = savedNotesIdentity(saved);
			if (
				child.sessionId !== identity.sessionId ||
				(child.agentName !== member.agentName &&
					contextStorageAgentName(child) !== member.agentName)
			)
				throw new Error(
					"Saved shared notes belong to a different agent family",
				);
			const result = await resolve(saved, destination, query);
			if (result) return result;
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
				!records(saved, "herdr-context-child").some(
					(value) =>
						Check(Member, value) &&
						value.threadId === parent.threadId &&
						value.sessionId === parent.sessionId &&
						[identity.agentName, contextStorageAgentName(identity)].includes(
							value.agentName,
						),
				)
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
