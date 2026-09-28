import { createHash } from "node:crypto";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

export const CONTEXT_AGENT_ENTRY = "codex-context-agent";

export interface ContextAgentIdentity {
	protocol: 1;
	sessionId: string;
	threadId: string;
	agentName: string;
	storage?: "remote" | "session";
	accountScope?: string;
	routing?: unknown;
}

export type ContextAgentBinding = Omit<ContextAgentIdentity, "threadId" | "storage"> & {
	storage: "remote" | "session";
};

export function parseContextAgentBinding(input: unknown): ContextAgentBinding {
	const value = input as Partial<ContextAgentBinding> | undefined;
	if (value?.protocol !== 1 || typeof value.sessionId !== "string" || !value.sessionId ||
		typeof value.agentName !== "string" || !/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(value.agentName) ||
		(value.storage !== "remote" && value.storage !== "session") ||
		(value.storage === "remote" && (typeof value.accountScope !== "string" || !/^[a-f0-9]{64}$/.test(value.accountScope))))
		throw new Error("Invalid Codex context identity");
	return { protocol: 1, sessionId: value.sessionId, agentName: value.agentName, storage: value.storage,
		...(value.accountScope === undefined ? {} : { accountScope: value.accountScope }),
		...(value.routing === undefined ? {} : { routing: value.routing }) };
}

export function contextAgentIdentity(ctx: Pick<ExtensionContext, "sessionManager">): ContextAgentIdentity {
	const threadId = ctx.sessionManager.getSessionId();
	let identity: ContextAgentIdentity | undefined;
	// Identity belongs to the session, not its active branch. Forks get a new identity.
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== CONTEXT_AGENT_ENTRY) continue;
		const value = entry.data as Partial<ContextAgentIdentity> | undefined;
		if (value?.threadId !== threadId) continue;
		if (identity) throw new Error("Conflicting persisted Codex context identities");
		identity = { ...parseContextAgentBinding(value), threadId };
	}
	return identity ?? { protocol: 1, sessionId: threadId, threadId, agentName: "/root" };
}

export function contextAccountScope(accountId: string): string {
	return createHash("sha256").update(accountId).digest("hex");
}

export function contextTargetAgent(namespace: "history" | "notes", params: Record<string, unknown>, agentName: string): string {
	const value = namespace === "history" ? params["agent_name"] : params["path"] ?? params["prefix"] ?? params["path_prefix"];
	if (value === undefined || value === null || value === "") return agentName;
	if (typeof value !== "string") throw new Error("Context path must be a string");
	if (namespace === "notes") {
		if (!value.startsWith("/")) return agentName;
		const match = /^(\/root(?:\/[a-zA-Z0-9_-]+)*?)\/notes(?:\/|$)/.exec(value);
		if (!match) throw new Error("Absolute note paths must use <agent>/notes[/path]");
		return match[1]!;
	}
	const target = value.startsWith("/") ? value : `${agentName}/${value}`;
	if (!/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(target)) throw new Error("Invalid history agent name");
	return target;
}
