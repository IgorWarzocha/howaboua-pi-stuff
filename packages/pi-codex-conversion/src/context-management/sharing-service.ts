import { randomUUID } from "node:crypto";
import { SessionManager, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { resolveCodexToolProvider } from "../adapter/codex-tool-provider.ts";
import {
	CONTEXT_SHARING_AVAILABLE, CONTEXT_SHARING_REQUEST,
	type ContextSharingService, type ContextRouter, type SharedContextRequest, type SharedContextResult,
} from "../context-sharing.ts";
import { CONTEXT_AGENT_ENTRY, contextAccountScope, contextAgentIdentity, contextTargetAgent } from "./agent-identity.ts";

export function registerContextSharingService(
	pi: ExtensionAPI,
	mode: (ctx: ExtensionContext) => ContextManagementMode,
	execute: (ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal) => Promise<SharedContextResult>,
): ContextRouter {
	let router: ContextRouter | undefined;
	const describe: ContextSharingService["describe"] = (ctx) => {
		const storageMode = mode(ctx);
		if (storageMode === "off") return undefined;
		const identity = contextAgentIdentity(ctx);
		const storage = storageMode === "remote" ? "remote" : "session";
		if (identity.storage && identity.storage !== storage)
			throw new Error(`Shared context requires ${identity.storage === "remote" ? "Remote" : "Local or Tree"} history storage in this session`);
		return { ...identity, storage };
	};
	const service: ContextSharingService = {
		protocol: 1,
		describe,
		async verify(ctx) {
			const identity = describe(ctx);
			if (identity?.storage !== "remote" || !identity.accountScope) return;
			const provider = await resolveCodexToolProvider(ctx);
			if (provider.route !== "openai-codex" || contextAccountScope(provider.accountId) !== identity.accountScope)
				throw new Error("Shared Remote context requires the parent's Codex account");
		},
		async createChild(ctx, options) {
			const parent = describe(ctx);
			if (!parent) throw new Error("Shared context requires notes-based continuity");
			if (!/^[a-zA-Z0-9_-]+$/.test(options.name)) throw new Error("Invalid context agent name");
			if (parent.storage === "session" && (!router || options.routing === undefined))
				throw new Error("Local and Tree sharing require a registered context router");
			await service.verify(ctx);
			if (parent.storage === "remote" && !parent.accountScope) {
				const provider = await resolveCodexToolProvider(ctx);
				if (provider.route !== "openai-codex") throw new Error("Shared Remote context requires Codex transport");
				parent.accountScope = contextAccountScope(provider.accountId);
			}
			if (ctx.sessionManager.getSessionId() !== parent.threadId) throw new Error("Controller session changed while preparing shared context");
			if (!contextAgentIdentity(ctx).storage) pi.appendEntry(CONTEXT_AGENT_ENTRY, parent);
			const session = SessionManager.inMemory(options.cwd);
			const identity = { protocol: 1 as const, sessionId: parent.sessionId, threadId: session.getSessionId(),
				agentName: `${parent.agentName}/${options.name}-${randomUUID()}`, storage: parent.storage!,
				...(parent.accountScope ? { accountScope: parent.accountScope } : {}),
				...(options.routing === undefined ? {} : { routing: options.routing }) };
			session.appendCustomEntry(CONTEXT_AGENT_ENTRY, identity);
			return { identity, jsonl: [session.getHeader(), ...session.getEntries()].map((entry) => JSON.stringify(entry)).join("\n") + "\n" };
		},
		async execute(ctx, request, signal) {
			const identity = describe(ctx);
			if (!identity || identity.sessionId !== request.sessionId || identity.agentName !== request.agentName ||
				(request.namespace !== "notes" && request.namespace !== "history") ||
				!request.params || typeof request.params !== "object" || Array.isArray(request.params) ||
				contextTargetAgent(request.namespace, request.params, identity.agentName) !== identity.agentName)
				throw new Error("Shared context request does not belong to this agent");
			if (identity.storage !== "session") throw new Error("Remote context uses the Codex backend, not peer routing");
			return execute(ctx, request, signal);
		},
		registerRouter(next) {
			if (router && router !== next) throw new Error("A context router is already registered");
			router = next;
			return () => { if (router === next) router = undefined; };
		},
	};
	const off = pi.events.on(CONTEXT_SHARING_REQUEST, () => pi.events.emit(CONTEXT_SHARING_AVAILABLE, service));
	pi.events.emit(CONTEXT_SHARING_AVAILABLE, service);
	pi.on("session_shutdown", () => { off(); router = undefined; });
	return async (ctx, request, signal) => {
		describe(ctx);
		if (!router) throw new Error("Cross-agent Local/Tree context requires an available context router");
		return router(ctx, request, signal);
	};
}
