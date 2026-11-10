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
import type { SavedSessionLoader } from "./context-sharing.js";
import type { HistorySearch } from "./history-search.js";
import type { SavedNotesSession } from "./saved-session.js";
import { createSavedSessionAccess } from "./saved-session-access.js";
import {
	Detachment,
	Member,
	Parent,
	Plan,
	Route,
	sameOwner,
	savedFamilyIdentity,
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
		(("code" in error &&
			[
				"ENOENT",
				"EACCES",
				"EPERM",
				"SAVED_SESSION_UNAVAILABLE",
				"ECONNREFUSED",
				"ECONNRESET",
				"EPIPE",
				"ETIMEDOUT",
			].includes(String(error.code))) ||
			/^(No shared context agent\b|Cross-agent (?:context requires an available context router|notes (?:are unavailable here|owner is unavailable))|Shared context (?:owner|controller) is unavailable|Shared context response was lost|Herdr machine .* is (?:unavailable|disconnected)|remote Shepherdr bridge (?:is unavailable|closed|exited\b)|remote Shepherdr context timed out|Unknown Core machine |Core machine .* is (?:unavailable|connecting)\b|Core is unavailable\b|Remote connection (?:closed|is not ready)\b|Remote request timed out\b)/.test(
				error.message,
			))
	);
}

/** Saved local notes do not need PCC, a router, or a running owner. Writes still belong to the live session. */
export async function readSharedNotes(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read" | "sessionFile">,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	loader?: SavedSessionLoader,
): Promise<Record<string, unknown> | undefined> {
	return readSharedSession(
		ctx,
		store,
		params,
		{ namespace: "notes" },
		signal,
		loader,
	);
}

export async function readSharedHistory(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read" | "sessionFile">,
	search: HistorySearch,
	params: Record<string, unknown>,
	signal?: AbortSignal,
	loader?: SavedSessionLoader,
): Promise<Record<string, unknown> | undefined> {
	return readSharedSession(
		ctx,
		store,
		params,
		{ namespace: "history", search },
		signal,
		loader,
	);
}

async function readSharedSession(
	ctx: ExtensionContext,
	store: Pick<NotesStore, "read" | "sessionFile">,
	params: Record<string, unknown>,
	access:
		| { namespace: "notes" }
		| { namespace: "history"; search: HistorySearch },
	signal?: AbortSignal,
	loader?: SavedSessionLoader,
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
	const { containingMachine, locator, load, indexed, find } =
		createSavedSessionAccess(store, namespace, loader, signal);
	let unavailable: unknown;
	let targetReached = false;
	async function exploratoryLoad(location: Parameters<typeof load>[0]) {
		try {
			return await load(location);
		} catch (error) {
			signal?.throwIfAborted();
			if (!sharedNotesUnavailable(error)) throw error;
			unavailable ??= error;
			return undefined;
		}
	}

	const { read, reference } = createSharedSessionReader(
		store,
		access,
		outputAgent,
		signal,
		load,
		resolve,
		sharedNotesUnavailable,
	);
	async function resolve(
		session: SavedNotesSession,
		destination: string,
		query: Record<string, unknown>,
	): Promise<Record<string, unknown> | undefined> {
		signal?.throwIfAborted();
		const key = `${containingMachine(session)}\0${session.threadId}`;
		if (visited.has(key)) return;
		visited.add(key);
		const identity = savedNotesIdentity(session);
		if (contextAgentNames(identity).includes(destination)) {
			targetReached = true;
			return read(session, query, destination);
		}
		const routes = new Map<string, Static<typeof Route>>();
		for (const value of records(session, "shepherdr-attachment-route"))
			if (
				Check(Route, value) &&
				value.plan.controllerSessionId === identity.threadId
			)
				routes.set(`${value.machine}\0${value.sessionFile}`, value);
		const matching = [...routes.values()].filter((route) => {
			const link = route.plan.context;
			return (
				route.phase === "ready" &&
				link &&
				(destination === canonicalAgentName(link.target.threadId) ||
					inside(destination, link.alias))
			);
		});
		if (matching.length > 1)
			throw new Error(
				"Saved shared address is ambiguous across machines. Use a unique attached alias, then retry.",
			);
		for (const route of matching) {
			targetReached = true;
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
				locator(session, route.machine, route.sessionFile),
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
			targetReached = true;
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
				link.controllerFile
					? locator(
							session,
							link.controllerMachine ?? "local",
							link.controllerFile,
						)
					: undefined,
				snapshot ?? link.controllerNotes,
				snapshot !== undefined,
			);
		}
		// Explicit attachment routes (including detach snapshots) own their addresses.
		if (session === current) {
			let saved: SavedNotesSession | undefined;
			try {
				saved = await indexed(current, destination);
			} catch (error) {
				signal?.throwIfAborted();
				if (!sharedNotesUnavailable(error)) throw error;
				unavailable ??= error;
			}
			if (saved) return resolve(saved, destination, query);
		}
		if (!savedFamilyIdentity(session)) return;
		let result: Record<string, unknown> | undefined;
		const members = records(session, "herdr-context-child").filter(
			(value) =>
				Check(Member, value) &&
				value.threadId === identity.threadId &&
				value.sessionId === identity.sessionId,
		);
		const direct = members.filter(
			(member) => Check(Member, member) && member.agentName === destination,
		);
		for (const member of direct.length ? direct : members) {
			if (!Check(Member, member)) continue;
			const location = locator(session, member.machine, member.sessionFile);
			// Only exploratory edges may be skipped. A recorded target must report its failure.
			const saved = await (direct.length
				? load(location)
				: exploratoryLoad(location));
			if (!saved) continue;
			const child = savedFamilyIdentity(saved);
			if (
				!child ||
				child.sessionId !== identity.sessionId ||
				(child.agentName !== member.agentName &&
					contextStorageAgentName(child) !== member.agentName)
			)
				throw new Error(
					"This session cannot access the requested saved context. Request an accessible handoff or note path from its owner.",
				);
			const candidate = await resolve(saved, destination, query);
			if (candidate) {
				if (result)
					throw new Error(
						"Saved shared address is ambiguous across machines. Use a unique attached alias, then retry.",
					);
				result = candidate;
			}
		}
		if (direct.length) return result;
		const routing = identity.routing;
		const suffix = ".jsonl.shepherdr-context.json";
		if (Check(Parent, routing)) {
			const parentLocator = routing.savedParent
				? locator(
						session,
						routing.savedParent.machine,
						routing.savedParent.sessionFile,
					)
				: routing.parent.endsWith(suffix)
					? locator(
							session,
							"local",
							routing.parent.slice(0, -".shepherdr-context.json".length),
						)
					: undefined;
			if (parentLocator) {
				const saved = await exploratoryLoad(parentLocator);
				if (!saved) return result;
				const parent = savedFamilyIdentity(saved);
				if (!parent || parent.sessionId !== identity.sessionId)
					throw new Error("Saved shared notes parent identity changed");
				const candidate = await resolve(saved, destination, query);
				if (candidate && result)
					throw new Error(
						"Saved shared address is ambiguous across machines. Use a unique attached alias, then retry.",
					);
				result = candidate ?? result;
			}
		}
		return result;
	}
	try {
		let result: Record<string, unknown> | undefined;
		try {
			result = await resolve(current, target, params);
		} catch (error) {
			signal?.throwIfAborted();
			if (!sharedNotesUnavailable(error)) throw error;
			unavailable ??= error;
		}
		// Legacy remote children may record only a now-dead relay parent. Find the
		// requested native thread once, never aliases or intermediate graph nodes.
		const family = savedFamilyIdentity(current);
		if (!result && !targetReached && family) {
			const candidates: SavedNotesSession[] = [];
			for (const location of await find(target)) {
				const saved = await exploratoryLoad(location);
				if (!saved) continue;
				if (saved.threadId !== target.slice(1))
					throw new Error(
						"Saved session discovery returned a different thread",
					);
				const member = savedFamilyIdentity(saved);
				if (
					member?.storage === "session" &&
					member.sessionId === family.sessionId &&
					member.agentName === target
				)
					candidates.push(saved);
			}
			if (candidates.length > 1)
				throw new Error(
					"Saved shared address is ambiguous across machines. Use a unique attached alias, then retry.",
				);
			if (candidates[0]) result = await read(candidates[0], params, target);
		}
		if (!result && unavailable) throw unavailable;
		return result;
	} catch (error) {
		if (
			error instanceof Error &&
			"code" in error &&
			["ENOENT", "EACCES", "EPERM"].includes(String(error.code))
		)
			throw Object.assign(
				new Error(
					`Saved ${namespace} could not be read on this machine. Request a handoff from the owner, or ask the user to restore access before retrying.`,
					{ cause: error },
				),
				{ code: "SAVED_SESSION_UNAVAILABLE" },
			);
		throw error;
	}
}
