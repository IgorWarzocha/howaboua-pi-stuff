import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import { resolveCodexToolProvider } from "../adapter/codex-tool-provider.ts";
import {
	CONTEXT_SHARING_AVAILABLE, CONTEXT_SHARING_REQUEST,
	type ContextSharingService, type ContextRouter, type SharedContextRequest, type SharedContextResult,
} from "../context-sharing.ts";
import { CONTEXT_AGENT_ENTRY, contextAccountScope, contextAgentIdentity, contextTargetAgent, parseContextAgentBinding } from "./agent-identity.ts";

async function verifyRemoteAccount(ctx: ExtensionContext, expected?: string): Promise<string> {
	const provider = await resolveCodexToolProvider(ctx);
	if (provider.route !== "openai-codex") throw new Error("Shared Remote context requires Codex transport");
	const scope = contextAccountScope(provider.accountId);
	if (expected && scope !== expected) throw new Error("Shared Remote context requires the parent's Codex account");
	return scope;
}

export function registerContextSharingService(
	pi: ExtensionAPI,
	plan: (ctx: ExtensionContext) => Pick<CodexRuntimePlan, "contextManagementMode" | "shareSubagentContext">,
	execute: (ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal) => Promise<SharedContextResult>,
): ContextRouter {
	let router: ContextRouter | undefined;
	const describe: ContextSharingService["describe"] = (ctx) => {
		const storageMode = plan(ctx).contextManagementMode;
		if (storageMode === "off") return undefined;
		const identity = contextAgentIdentity(ctx);
		const storage = storageMode === "remote" ? "remote" : "session";
		if (identity.storage && identity.storage !== storage)
			throw new Error(`Shared context requires ${identity.storage === "remote" ? "Remote" : "Local or Tree"} history storage in this session`);
		return { ...identity, storage };
	};
	const service: ContextSharingService = {
		protocol: 1,
		canCreateChild: (ctx) => plan(ctx).shareSubagentContext,
		describe,
		async verify(ctx) {
			const identity = describe(ctx);
			if (identity?.storage !== "remote" || !identity.accountScope) return;
			await verifyRemoteAccount(ctx, identity.accountScope);
		},
		async createChild(ctx, options) {
			if (!service.canCreateChild(ctx)) throw new Error("Shared subagent context is disabled; enable it in /codex context");
			const parent = describe(ctx);
			if (!parent) throw new Error("Shared context requires notes-based continuity");
			if (!/^[a-zA-Z0-9_-]+$/.test(options.name)) throw new Error("Invalid context agent name");
			if (parent.storage === "session" && (!router || options.routing === undefined))
				throw new Error("Local and Tree sharing require a registered context router");
			if (parent.storage === "remote") parent.accountScope = await verifyRemoteAccount(ctx, parent.accountScope);
			if (ctx.sessionManager.getSessionId() !== parent.threadId) throw new Error("Controller session changed while preparing shared context");
			const binding = { protocol: 1 as const, sessionId: parent.sessionId,
				agentName: `${parent.agentName}/${options.name}-${randomUUID()}`, storage: parent.storage!,
				...(parent.accountScope ? { accountScope: parent.accountScope } : {}),
				...(options.routing === undefined ? {} : { routing: options.routing }) };
			return { binding, async adopt() {
				if (parent.storage === "remote") await verifyRemoteAccount(ctx, parent.accountScope);
				const current = describe(ctx);
				if (!current || current.threadId !== parent.threadId || current.sessionId !== parent.sessionId ||
					current.agentName !== parent.agentName || current.storage !== parent.storage ||
					(current.accountScope !== undefined && current.accountScope !== parent.accountScope))
					throw new Error("Controller context changed while binding shared context");
				if (!contextAgentIdentity(ctx).storage) pi.appendEntry(CONTEXT_AGENT_ENTRY, parent);
			} };
		},
		async bind(ctx, input) {
			const binding = parseContextAgentBinding(input);
			if (binding.agentName === "/root") throw new Error("Shared context binding requires a child agent path");
			const identity = { ...binding, threadId: ctx.sessionManager.getSessionId() };
			const check = () => {
				if (ctx.sessionManager.getSessionId() !== identity.threadId) throw new Error("Worker session changed while binding shared context");
				const current = describe(ctx);
				if (!current || current.storage !== binding.storage)
					throw new Error("Shared context binding requires matching history storage");
				if (contextAgentIdentity(ctx).storage) {
					if (!isDeepStrictEqual(current, identity)) throw new Error("An existing context identity cannot be rebound");
					return true;
				}
				if (!ctx.isIdle() || ctx.sessionManager.getEntries().some((entry) =>
					entry.type === "message" || entry.type === "custom_message" || entry.type === "compaction" || entry.type === "branch_summary" ||
					(entry.type === "custom" && entry.customType.startsWith("codex-context-"))))
					throw new Error("Shared context can bind only a fresh, idle Pi session before its first turn");
				if (binding.storage === "session" && !router) throw new Error("Local and Tree sharing require a registered context router");
				return false;
			};
			check();
			if (binding.storage === "remote") await verifyRemoteAccount(ctx, binding.accountScope);
			// Auth can yield to input or a session switch; the live owner commits only while still fresh.
			if (!check()) pi.appendEntry(CONTEXT_AGENT_ENTRY, identity);
			return identity;
		},
		async execute(ctx, request, signal) {
			signal?.throwIfAborted();
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
