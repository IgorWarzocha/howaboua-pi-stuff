import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";

export const CONTEXT_AGENT_ENTRY = "codex-context-agent";
const CONTEXT_BACKEND_ENTRY = "codex-context-backend";

export interface ContextAgentIdentity {
	protocol: 1;
	sessionId: string;
	threadId: string;
	agentName: string;
	/** Original persisted Notes address; never changes authenticated remote ownership. */
	storageAgentName?: string;
	storage?: "remote" | "session";
	accountScope?: string;
	backendUrl?: string;
	routing?: unknown;
}

export type ContextAgentBinding = Omit<
	ContextAgentIdentity,
	"threadId" | "storage"
> & {
	storage: "remote" | "session";
};

export const CONTEXT_AGENT_PATTERN =
	"^/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*(?:/[a-zA-Z0-9_-][a-zA-Z0-9_.-]*)*$";

export function isContextAgentName(value: unknown): value is string {
	return (
		typeof value === "string" && new RegExp(CONTEXT_AGENT_PATTERN).test(value)
	);
}

export function canonicalAgentName(threadId: string): string {
	if (threadId === "root")
		throw new Error(
			"Pi session ID root conflicts with the legacy /root reference; start a session with another ID",
		);
	const name = `/${threadId}`;
	if (!/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(threadId))
		throw new Error("Invalid Pi session identity");
	return name;
}

export function contextStorageAgentName(
	identity: Pick<ContextAgentIdentity, "agentName" | "storageAgentName">,
): string {
	return identity.storageAgentName ?? identity.agentName;
}

/** /root is a local compatibility alias, never an authenticated storage address. */
export function contextAgentNames(
	identity: Pick<
		ContextAgentIdentity,
		"agentName" | "storageAgentName" | "threadId" | "sessionId"
	>,
): string[] {
	return [
		...new Set([
			identity.agentName,
			contextStorageAgentName(identity),
			...(identity.threadId === identity.sessionId ? ["/root"] : []),
		]),
	];
}

export function canonicalContextIdentity<T extends ContextAgentIdentity>(
	identity: T,
): T {
	const agentName = canonicalAgentName(identity.threadId);
	return {
		...identity,
		agentName,
		...(contextStorageAgentName(identity) === agentName
			? {}
			: { storageAgentName: contextStorageAgentName(identity) }),
	};
}

export function parseContextAgentBinding(input: unknown): ContextAgentBinding {
	const value = input as Partial<ContextAgentBinding> | undefined;
	if (
		value?.protocol !== 1 ||
		typeof value.sessionId !== "string" ||
		!value.sessionId ||
		typeof value.agentName !== "string" ||
		!isContextAgentName(value.agentName) ||
		(value.storageAgentName !== undefined &&
			!isContextAgentName(value.storageAgentName)) ||
		(value.storage !== "remote" && value.storage !== "session") ||
		(value.backendUrl !== undefined &&
			(typeof value.backendUrl !== "string" || !value.backendUrl)) ||
		(value.storage === "remote" &&
			(typeof value.accountScope !== "string" ||
				!/^[a-f0-9]{64}$/.test(value.accountScope)))
	)
		throw new Error("Invalid Codex context identity");
	return {
		protocol: 1,
		sessionId: value.sessionId,
		agentName: value.agentName,
		...(value.storageAgentName === undefined
			? {}
			: { storageAgentName: value.storageAgentName }),
		storage: value.storage,
		...(value.accountScope === undefined
			? {}
			: { accountScope: value.accountScope }),
		...(value.backendUrl === undefined ? {} : { backendUrl: value.backendUrl }),
		...(value.routing === undefined ? {} : { routing: value.routing }),
	};
}

/** Older standalone remote owners may have a backend pin without a family binding. */
export function pinnedContextIdentity(
	threadId: string,
	entries: readonly SessionEntry[],
): ContextAgentIdentity | undefined {
	let identity: ContextAgentIdentity | undefined;
	for (const entry of entries) {
		if (entry.type !== "custom" || entry.customType !== CONTEXT_BACKEND_ENTRY)
			continue;
		const pin = entry.data as Partial<ContextAgentIdentity> | undefined;
		if (pin?.threadId !== threadId) continue;
		const binding = parseContextAgentBinding({
			...pin,
			protocol: 1,
			storage: "remote",
		});
		if (!binding.backendUrl)
			throw new Error("Saved remote context has no backend address");
		if (
			identity &&
			(identity.sessionId !== binding.sessionId ||
				identity.agentName !== binding.agentName ||
				identity.accountScope !== binding.accountScope ||
				identity.backendUrl !== binding.backendUrl)
		)
			throw new Error("Conflicting persisted Remote context backend");
		identity = { ...binding, threadId };
	}
	return identity;
}

export function contextAgentIdentity(
	ctx: Pick<ExtensionContext, "sessionManager">,
): ContextAgentIdentity {
	const threadId = ctx.sessionManager.getSessionId();
	let identity: ContextAgentIdentity | undefined;
	// Identity belongs to the session, not its active branch. Forks get a new identity.
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== CONTEXT_AGENT_ENTRY)
			continue;
		const value = entry.data as Partial<ContextAgentIdentity> | undefined;
		if (value?.threadId !== threadId) continue;
		if (identity)
			throw new Error("Conflicting persisted Codex context identities");
		identity = { ...parseContextAgentBinding(value), threadId };
	}
	identity ??= pinnedContextIdentity(threadId, ctx.sessionManager.getEntries());
	if (identity?.storage === "remote") {
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type !== "custom" || entry.customType !== CONTEXT_BACKEND_ENTRY)
				continue;
			const pin = entry.data as Partial<ContextAgentIdentity> | undefined;
			if (pin?.threadId !== threadId) continue;
			if (
				pin.sessionId !== identity.sessionId ||
				(pin.storageAgentName ?? pin.agentName) !==
					contextStorageAgentName(identity) ||
				pin.accountScope !== identity.accountScope ||
				typeof pin.backendUrl !== "string" ||
				!pin.backendUrl ||
				(identity.backendUrl && identity.backendUrl !== pin.backendUrl)
			)
				throw new Error("Conflicting persisted Remote context backend");
			identity.backendUrl = pin.backendUrl;
		}
	}
	return canonicalContextIdentity(
		identity ?? {
			protocol: 1,
			sessionId: threadId,
			threadId,
			agentName: canonicalAgentName(threadId),
		},
	);
}

export function contextTargetAgent(
	namespace: "history" | "notes",
	params: Record<string, unknown>,
	agentName: string,
): string {
	const value =
		namespace === "history"
			? params["agent_name"]
			: (params["path"] ?? params["prefix"] ?? params["path_prefix"]);
	if (value === undefined || value === null || value === "") return agentName;
	if (typeof value !== "string")
		throw new Error("Context path must be a string");
	if (namespace === "notes") {
		if (!value.startsWith("/")) return agentName;
		const boundary = /\/notes(?:\/|$)/.exec(value)?.index ?? -1;
		const target = boundary < 0 ? "" : value.slice(0, boundary);
		if (
			!isContextAgentName(target) ||
			!/^\/notes(?:\/|$)/.test(value.slice(boundary))
		)
			throw new Error("Absolute note paths must use <agent>/notes[/path]");
		return target;
	}
	const target = value.startsWith("/") ? value : `${agentName}/${value}`;
	if (!isContextAgentName(target))
		throw new Error("Invalid history agent name");
	return target;
}
