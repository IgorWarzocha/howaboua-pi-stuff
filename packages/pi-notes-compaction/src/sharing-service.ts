import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import {
	CONTEXT_AGENT_ENTRY,
	contextAgentIdentity,
	contextTargetAgent,
	parseContextAgentBinding,
} from "./agent-identity.js";
import {
	readAttachmentSnapshot,
	readRemoteNoteReference,
} from "./attachment-snapshot.js";
import { bindingStartupEntries } from "./binding-startup.js";
import type { NotesOwner } from "./bridge.js";
import {
	CONTEXT_SHARING_AVAILABLE,
	CONTEXT_SHARING_REQUEST,
	type ContextRouter,
	type ContextSharingService,
	type SharedContextRequest,
	type SharedContextResult,
} from "./context-sharing.js";
import { exportNotesSnapshot } from "./notes.js";

export function registerContextSharingService(
	pi: ExtensionAPI,
	config: {
		enabled(ctx: ExtensionContext): boolean;
		shareSubagentContext(ctx: ExtensionContext): boolean;
		execute(
			ctx: ExtensionContext,
			request: SharedContextRequest,
			signal?: AbortSignal,
		): Promise<SharedContextResult>;
		owner(): NotesOwner;
	},
): ContextRouter {
	let router: ContextRouter | undefined;
	const describe: ContextSharingService["describe"] = (ctx) => {
		const storageMode = config.enabled(ctx);
		if (!storageMode) return undefined;
		const identity = contextAgentIdentity(ctx);
		// Saved attachment identities are immutable even after their writer retires.
		const storage = identity.storage ?? "session";
		return { ...identity, storage };
	};
	const inspectAttachment: NonNullable<
		ContextSharingService["inspectAttachment"]
	> = (ctx, standalone = true) => {
		const check = () => {
			const identity = describe(ctx);
			if (!identity)
				throw new Error("Context attachment requires notes-based continuity");
			if (standalone && !ctx.isIdle())
				throw new Error("Attach context only after the target settles");
			if (!ctx.sessionManager.getSessionFile())
				throw new Error("Context attachment requires a saved Pi session");
			if (standalone && contextAgentIdentity(ctx).storage)
				throw new Error("Target already belongs to a shared context family");
			if (!router)
				throw new Error(
					"Context attachment requires an available context router",
				);
			return identity;
		};
		const identity = check();
		return identity;
	};
	const service: ContextSharingService = {
		protocol: 1,
		canCreateChild: (ctx) => config.shareSubagentContext(ctx),
		describe,
		async verify() {},
		async createChild(ctx, options) {
			if (!service.canCreateChild(ctx))
				throw new Error(
					"Shared subagent context is disabled; enable it in /notes",
				);
			const parent = describe(ctx);
			if (!parent)
				throw new Error("Shared context requires notes-based continuity");
			if (!/^[a-zA-Z0-9_-]+$/.test(options.name))
				throw new Error("Invalid context agent name");
			if (!router || options.routing === undefined)
				throw new Error("Local sharing requires a registered context router");

			if (ctx.sessionManager.getSessionId() !== parent.threadId)
				throw new Error(
					"Controller session changed while preparing shared context",
				);
			const binding = {
				protocol: 1 as const,
				sessionId: parent.sessionId,
				agentName: `${parent.agentName}/${options.name}-${randomUUID()}`,
				storage: "session" as const,
				...(parent.accountScope ? { accountScope: parent.accountScope } : {}),
				...(parent.backendUrl ? { backendUrl: parent.backendUrl } : {}),
				...(options.routing === undefined ? {} : { routing: options.routing }),
			};
			return {
				binding,
				async adopt() {
					const current = describe(ctx);
					if (
						!current ||
						current.threadId !== parent.threadId ||
						current.sessionId !== parent.sessionId ||
						current.agentName !== parent.agentName ||
						current.storage !== parent.storage ||
						(current.accountScope !== undefined &&
							current.accountScope !== parent.accountScope)
					)
						throw new Error(
							"Controller context changed while binding shared context",
						);
					if (!contextAgentIdentity(ctx).storage)
						pi.appendEntry(CONTEXT_AGENT_ENTRY, parent);
				},
			};
		},
		async bind(ctx, input, options) {
			const binding = parseContextAgentBinding(input);
			if (binding.agentName === "/root")
				throw new Error("Shared context binding requires a child agent path");
			const identity = {
				...binding,
				threadId: ctx.sessionManager.getSessionId(),
			};
			const check = () => {
				if (ctx.sessionManager.getSessionId() !== identity.threadId)
					throw new Error(
						"Worker session changed while binding shared context",
					);
				const current = describe(ctx);
				if (!current || current.storage !== binding.storage)
					throw new Error(
						"Shared context binding requires matching history storage",
					);
				if (contextAgentIdentity(ctx).storage) {
					if (!isDeepStrictEqual(current, identity))
						throw new Error("An existing context identity cannot be rebound");
					return true;
				}
				const owner = config.owner();
				const entries = bindingStartupEntries(ctx, options);
				if (!ctx.isIdle() || !owner.canBind?.(ctx, entries))
					throw new Error(
						"Shared context requires an idle child before its first turn; inherited fork history needs an explicit boundary",
					);
				if (binding.storage === "session" && !router)
					throw new Error("Local sharing requires a registered context router");
				return false;
			};
			check();
			if (binding.storage === "remote")
				throw new Error("New shared agents require local Notes storage");
			// Auth can yield to input or a session switch; the live owner commits only while still fresh.
			if (!check()) pi.appendEntry(CONTEXT_AGENT_ENTRY, identity);
			return identity;
		},
		inspectAttachment,
		retainAttachmentIdentity(ctx) {
			const native = describe(ctx);
			if (!native || !router || !ctx.sessionManager.getSessionFile())
				throw new Error(
					"Context attachment requires a saved owner and live router",
				);
			const identity = native;
			if (!contextAgentIdentity(ctx).storage)
				pi.appendEntry(CONTEXT_AGENT_ENTRY, identity);
			return identity;
		},
		async execute(ctx, request, signal) {
			signal?.throwIfAborted();
			const identity = describe(ctx);
			if (
				!identity ||
				identity.sessionId !== request.sessionId ||
				identity.agentName !== request.agentName ||
				(request.namespace !== "notes" && request.namespace !== "history") ||
				!request.params ||
				typeof request.params !== "object" ||
				Array.isArray(request.params) ||
				contextTargetAgent(
					request.namespace,
					request.params,
					identity.agentName,
				) !== identity.agentName
			)
				throw new Error("Shared context request does not belong to this agent");
			if (request.encryptedArguments)
				throw new Error(
					"Encrypted Remote arguments cannot execute against Local storage; use Code or Notebook history/notes with ordinary query/text",
				);
			return config.execute(ctx, request, signal);
		},
		exportAttachmentNotes(ctx) {
			const identity = describe(ctx);
			if (!identity)
				throw new Error("Checkpoint export requires notes-based continuity");
			if (identity.storage === "remote") {
				if (!identity.backendUrl)
					throw new Error("Saved remote context has no backend address");
				return {
					protocol: 1,
					storage: "remote",
					timestamp: Date.now(),
					identity,
					baseUrl: identity.backendUrl,
				};
			}

			const snapshot = exportNotesSnapshot(
				ctx.sessionManager.getBranch(),
				identity.agentName,
			);
			return {
				...snapshot,
				files: snapshot.files.filter(
					(file) =>
						contextTargetAgent(
							"notes",
							{ path: file.path },
							identity.agentName,
						) === identity.agentName,
				),
			};
		},
		validateAttachmentNotes(snapshot, identity) {
			if (identity.storage === "remote") {
				if (
					!isDeepStrictEqual(
						readRemoteNoteReference(snapshot).identity,
						identity,
					)
				)
					throw new Error("Remote checkpoint owner changed");
			} else
				readAttachmentSnapshot(snapshot, {
					action: "list_files_by_prefix",
					prefix: `${identity.agentName}/notes`,
				});
		},
		async verifyAttachmentAccess(ctx, snapshot) {
			if (
				!snapshot ||
				typeof snapshot !== "object" ||
				!("storage" in snapshot) ||
				snapshot.storage !== "remote"
			)
				return;
			const { verifyRemoteReference } = await import("./remote.js");
			await verifyRemoteReference(ctx, readRemoteNoteReference(snapshot));
		},
		async executeRemoteAttachment(ctx, snapshot, request, signal) {
			if (request.namespace === "history")
				throw new Error(
					"History is unavailable from a saved remote notes attachment. Open its saved Pi JSONL session on this machine, then retry.",
				);
			const { executeRemoteAttachment } = await import("./remote.js");
			return executeRemoteAttachment(
				ctx,
				readRemoteNoteReference(snapshot),
				request,
				signal,
			);
		},
		parseAttachmentNotes(input, identity) {
			if (!Array.isArray(input))
				throw new Error("Invalid persisted checkpoint entries");
			const entries: SessionEntry[] = input.map((entry: unknown) => {
				if (
					!entry ||
					typeof entry !== "object" ||
					!("type" in entry) ||
					!(
						(entry.type === "custom" &&
							"customType" in entry &&
							typeof entry.customType === "string" &&
							"data" in entry) ||
						(entry.type === "branch_summary" && "details" in entry)
					)
				)
					throw new Error("Invalid persisted checkpoint entry");
				return entry as SessionEntry;
			});
			const snapshot = exportNotesSnapshot(entries, identity.agentName);
			return {
				...snapshot,
				files: snapshot.files.filter(
					(file) =>
						contextTargetAgent(
							"notes",
							{ path: file.path },
							identity.agentName,
						) === identity.agentName,
				),
			};
		},
		readAttachmentNotes(snapshot, params) {
			const details = readAttachmentSnapshot(snapshot, params);
			return {
				content: [{ type: "text", text: JSON.stringify(details) }],
				details: { codexHistoryNotes: details },
			};
		},
		registerRouter(next) {
			if (router && router !== next)
				throw new Error("A context router is already registered");
			router = next;
			return () => {
				if (router === next) router = undefined;
			};
		},
	};
	const off = pi.events.on(CONTEXT_SHARING_REQUEST, () =>
		pi.events.emit(CONTEXT_SHARING_AVAILABLE, service),
	);
	pi.events.emit(CONTEXT_SHARING_AVAILABLE, service);
	pi.on("session_shutdown", () => {
		off();
		router = undefined;
	});
	return Object.assign(
		async (
			ctx: ExtensionContext,
			request: SharedContextRequest,
			signal?: AbortSignal,
		) => {
			describe(ctx);
			if (!router) {
				throw new Error(
					"Cross-agent context requires an available context router",
				);
			}
			return router(ctx, request, signal);
		},
		{
			requiresRemoteScope: (ctx: ExtensionContext) =>
				router?.requiresRemoteScope?.(ctx) ?? false,
		},
	);
}
