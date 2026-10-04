import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { CodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import {
	CONTEXT_SHARING_AVAILABLE, CONTEXT_SHARING_REQUEST,
	type ContextSharingService, type ContextRouter, type SharedContextRequest, type SharedContextResult,
} from "../context-sharing.ts";
import { CONTEXT_AGENT_ENTRY, CONTEXT_BACKEND_ENTRY, contextAccountScope, contextAgentIdentity, contextTargetAgent, parseContextAgentBinding } from "./agent-identity.ts";
import { createPiSessionNotesSnapshot, readPiSessionNotesSnapshot } from "./local-notes.ts";
import { executeRemoteAttachment } from "./history-notes.ts";
import { readRemoteNoteReference, resolveRemoteContextProvider, REMOTE_ACCOUNT_MISMATCH, REMOTE_CONTEXT_UNAVAILABLE } from "./remote-scope.ts";

async function verifyRemoteAccount(ctx: ExtensionContext, expected?: string, backendUrl?: string): Promise<string> {
	const provider = await resolveRemoteContextProvider(ctx);
	const scope = contextAccountScope(provider.accountId);
	if (expected && scope !== expected) throw new Error(REMOTE_ACCOUNT_MISMATCH);
	if (backendUrl && backendUrl !== provider.baseUrl) throw new Error(REMOTE_CONTEXT_UNAVAILABLE);
	return scope;
}

export function registerContextSharingService(
	pi: ExtensionAPI,
	plan: (ctx: ExtensionContext) => Pick<CodexRuntimePlan, "contextManagementMode" | "shareSubagentContext">,
	execute: (ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal) => Promise<SharedContextResult>,
): ContextRouter {
	let router: ContextRouter | undefined;
	const preparedAttachments = new WeakMap<ExtensionContext, { native: ReturnType<ContextSharingService["describe"]>; identity: NonNullable<ReturnType<ContextSharingService["describe"]>>; model: string }>();
	const describe: ContextSharingService["describe"] = (ctx) => {
		const storageMode = plan(ctx).contextManagementMode;
		if (storageMode === "off") return undefined;
		const identity = contextAgentIdentity(ctx);
		const storage = storageMode === "remote" ? "remote" : "session";
		if (identity.storage && identity.storage !== storage)
			throw new Error(`Shared context requires ${identity.storage === "remote" ? "Remote" : "Local or Tree"} history storage in this session`);
		return { ...identity, storage };
	};
	const inspectAttachment: NonNullable<ContextSharingService["inspectAttachment"]> = (ctx, standalone = true) => {
		const check = () => {
			const identity = describe(ctx);
			if (!identity) throw new Error("Context attachment requires notes-based continuity");
			if (standalone && !ctx.isIdle()) throw new Error("Attach context only after the target settles");
			if (!ctx.sessionManager.getSessionFile()) throw new Error("Context attachment requires a saved Pi session");
			if (standalone && contextAgentIdentity(ctx).storage) throw new Error("Target already belongs to a shared context family");
			if (!router) throw new Error("Context attachment requires an available context router");
			return identity;
		};
		const identity = check();
		if (identity.storage !== "remote") return identity;
		const model = JSON.stringify(ctx.model);
		return (async () => {
			const provider = await resolveRemoteContextProvider(ctx);
			if (identity.accountScope && identity.accountScope !== contextAccountScope(provider.accountId))
				throw new Error(REMOTE_ACCOUNT_MISMATCH);
			if (identity.backendUrl && identity.backendUrl !== provider.baseUrl) throw new Error(REMOTE_CONTEXT_UNAVAILABLE);
			if (!isDeepStrictEqual(check(), identity) || JSON.stringify(ctx.model) !== model) throw new Error("Context changed during attachment authentication; retry");
			const verified = { ...identity, accountScope: contextAccountScope(provider.accountId), backendUrl: provider.baseUrl };
			preparedAttachments.set(ctx, { native: identity, identity: verified, model });
			return verified;
		})();
	};
	const service: ContextSharingService = {
		protocol: 1,
		canCreateChild: (ctx) => plan(ctx).shareSubagentContext,
		describe,
		async verify(ctx) {
			const identity = describe(ctx);
			if (identity?.storage !== "remote" || !identity.accountScope) return;
			await verifyRemoteAccount(ctx, identity.accountScope, identity.backendUrl);
		},
		async createChild(ctx, options) {
			if (!service.canCreateChild(ctx)) throw new Error("Shared subagent context is disabled; enable it in /codex context");
			const parent = describe(ctx);
			if (!parent) throw new Error("Shared context requires notes-based continuity");
			if (!/^[a-zA-Z0-9_-]+$/.test(options.name)) throw new Error("Invalid context agent name");
			if (parent.storage === "session" && (!router || options.routing === undefined))
				throw new Error("Local and Tree sharing require a registered context router");
			if (parent.storage === "remote") parent.accountScope = await verifyRemoteAccount(ctx, parent.accountScope, parent.backendUrl);
			if (ctx.sessionManager.getSessionId() !== parent.threadId) throw new Error("Controller session changed while preparing shared context");
			const binding = { protocol: 1 as const, sessionId: parent.sessionId,
				agentName: `${parent.agentName}/${options.name}-${randomUUID()}`, storage: parent.storage!,
				...(parent.accountScope ? { accountScope: parent.accountScope } : {}),
				...(parent.backendUrl ? { backendUrl: parent.backendUrl } : {}),
				...(options.routing === undefined ? {} : { routing: options.routing }) };
			return { binding, async adopt() {
				if (parent.storage === "remote") await verifyRemoteAccount(ctx, parent.accountScope, parent.backendUrl);
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
			if (binding.storage === "remote") await verifyRemoteAccount(ctx, binding.accountScope, binding.backendUrl);
			// Auth can yield to input or a session switch; the live owner commits only while still fresh.
			if (!check()) pi.appendEntry(CONTEXT_AGENT_ENTRY, identity);
			return identity;
		},
		inspectAttachment,
		retainAttachmentIdentity(ctx) {
			const native = describe(ctx);
			if (!native || !router || !ctx.sessionManager.getSessionFile()) throw new Error("Context attachment requires a saved owner and live router");
			const prepared = preparedAttachments.get(ctx);
			if (native.storage === "remote" && (!prepared || !isDeepStrictEqual(prepared.native, native) || prepared.model !== JSON.stringify(ctx.model)))
				throw new Error("Remote attachment authentication changed; inspect the original owner and retry");
			const identity = native.storage === "remote" ? prepared!.identity : native;
			if (!contextAgentIdentity(ctx).storage) pi.appendEntry(CONTEXT_AGENT_ENTRY, identity);
			else if (identity.storage === "remote" && !native.backendUrl)
				pi.appendEntry(CONTEXT_BACKEND_ENTRY, { threadId: identity.threadId, sessionId: identity.sessionId,
					agentName: identity.agentName, accountScope: identity.accountScope, backendUrl: identity.backendUrl });
			if (prepared) prepared.native = identity;
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
			if (request.encryptedArguments)
				throw new Error("Encrypted Remote arguments cannot execute against Local or Tree storage; use Code or Notebook history/notes with ordinary query/text");
			if (identity.storage !== "session") throw new Error("Remote context requires reader-host authenticated dispatch");
			return execute(ctx, request, signal);
		},
		exportAttachmentNotes(ctx) {
			const identity = describe(ctx);
			if (!identity) throw new Error("Checkpoint export requires notes-based continuity");
			if (identity.storage === "remote") return Promise.resolve(inspectAttachment(ctx, false)).then(verified =>
				({ protocol: 1 as const, storage: "remote" as const, timestamp: Date.now(), identity: verified, baseUrl: verified.backendUrl! }));
			const snapshot = createPiSessionNotesSnapshot(ctx.sessionManager.getBranch());
			return { ...snapshot, files: snapshot.files.filter((file) => contextTargetAgent("notes", { path: file.path }, identity.agentName) === identity.agentName) };
		},
		validateAttachmentNotes(snapshot, identity) {
			if (identity.storage === "remote") {
				if (!isDeepStrictEqual(readRemoteNoteReference(snapshot).identity, identity)) throw new Error("Remote checkpoint owner changed");
			} else readPiSessionNotesSnapshot(snapshot, { action: "list_files_by_prefix", prefix: `${identity.agentName}/notes` });
		},
		async verifyAttachmentAccess(ctx, snapshot) {
			if (!snapshot || typeof snapshot !== "object" || !("storage" in snapshot) || snapshot.storage !== "remote") return;
			const reference = readRemoteNoteReference(snapshot);
			const identity = describe(ctx);
			const model = JSON.stringify(ctx.model);
			const provider = await resolveRemoteContextProvider(ctx);
			if (reference.identity.accountScope !== contextAccountScope(provider.accountId)) throw new Error(REMOTE_ACCOUNT_MISMATCH);
			if (reference.baseUrl !== provider.baseUrl) throw new Error(REMOTE_CONTEXT_UNAVAILABLE);
			if (!isDeepStrictEqual(describe(ctx), identity) || JSON.stringify(ctx.model) !== model)
				throw new Error("Context changed during attachment authentication; retry");
		},
		async executeRemoteAttachment(ctx, snapshot, request, signal) {
			return executeRemoteAttachment(ctx, readRemoteNoteReference(snapshot), request, signal);
		},
		parseAttachmentNotes(input, identity) {
			if (!Array.isArray(input)) throw new Error("Invalid persisted checkpoint entries");
			const entries: SessionEntry[] = input.map((entry: unknown) => {
				if (!entry || typeof entry !== "object" || !("type" in entry) ||
					!((entry.type === "custom" && "customType" in entry && typeof entry.customType === "string" && "data" in entry) ||
					(entry.type === "branch_summary" && "details" in entry))) throw new Error("Invalid persisted checkpoint entry");
				return entry as SessionEntry;
			});
			const snapshot = createPiSessionNotesSnapshot(entries, undefined, true);
			return { ...snapshot, files: snapshot.files.filter((file) => contextTargetAgent("notes", { path: file.path }, identity.agentName) === identity.agentName) };
		},
		readAttachmentNotes(snapshot, params) {
			const details = readPiSessionNotesSnapshot(snapshot, params);
			return { content: [{ type: "text", text: JSON.stringify(details) }], details: { codexHistoryNotes: details } };
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
	return Object.assign(async (ctx: ExtensionContext, request: SharedContextRequest, signal?: AbortSignal) => {
		describe(ctx);
		if (!router) {
			if (describe(ctx)?.storage === "remote") return undefined;
			throw new Error("Cross-agent context requires an available context router");
		}
		return router(ctx, request, signal);
	}, { requiresRemoteScope: (ctx: ExtensionContext) => router?.requiresRemoteScope?.(ctx) ?? false });
}
