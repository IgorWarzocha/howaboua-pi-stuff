import type { NotesBridge, CachedResponse } from "./external-notes-protocol.ts";
import type { ContextRouter } from "../context-sharing.ts";
import { contextAgentIdentity, contextTargetAgent } from "./agent-identity.ts";
import { lookupRemoteHistoryNotes } from "./history-notes.ts";
import { bindRemoteBackendScope, resolveRemoteContextProvider, remoteContextScope } from "./remote-scope.ts";

/** Provider services remain PCC-owned; continuity and the response cache do not. */
export function createExternalNotesRemoteService(router?: ContextRouter): Pick<NotesBridge,
	"lookup" | "canProject" | "projectResult" | "agentName" | "route"> {
	return {
		canProject: ctx => ctx.model?.api === "openai-codex-responses",
		agentName: ctx => contextAgentIdentity(ctx).agentName,
		async lookup(query, ctx, signal) {
			const response = await lookupRemoteHistoryNotes(query.namespace, query.params, ctx, signal);
			return [{ query, ...response, fetchedAt: Date.now(), coverage: "unknown" }];
		},
		async projectResult(result, responses, callId, ctx, signal) {
			signal?.throwIfAborted();
			if (!callId) throw new Error("Protected delivery requires a current tool call");
			if (!responses.length) return { ...result, content: result.content.map(part => ({ ...part })) };
			const identity = contextAgentIdentity(ctx);
			const before = JSON.stringify([identity, ctx.model?.api, ctx.model?.provider, ctx.model?.id, ctx.model?.baseUrl]);
			const provider = await resolveRemoteContextProvider(ctx);
			if (before !== JSON.stringify([contextAgentIdentity(ctx), ctx.model?.api, ctx.model?.provider, ctx.model?.id, ctx.model?.baseUrl]))
				throw new Error("Context changed during authentication; retry in the original session");
			const scope = remoteContextScope(identity, provider.accountId, provider.baseUrl);
			signal?.throwIfAborted();
			const outputs = responses.map((response: CachedResponse, index: number) => {
				if (response.source !== scope) throw new Error("Cached response belongs to a different context");
				const envelope: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
				if (!envelope || typeof envelope !== "object" || !("encrypted_output" in envelope) ||
					typeof envelope.encrypted_output !== "string" || !envelope.encrypted_output.trim())
					throw new Error("Cached response contains no protected output");
				const hint = "attachment_hint" in envelope && typeof envelope.attachment_hint === "string" ? envelope.attachment_hint : undefined;
				return { resultId: `${callId}:${index}`, name: response.query.namespace + (hint ? `; ${hint}` : ""), encryptedOutput: envelope.encrypted_output };
			});
			const codexHistoryNotes = { cachedOutputs: outputs };
			bindRemoteBackendScope(codexHistoryNotes, scope);
			return { ...result, content: result.content.map(part => ({ ...part })),
				details: { ...(result.details && typeof result.details === "object" ? result.details : {}), codexHistoryNotes } };
		},
		async route(query, _callId, ctx, signal) {
			const identity = contextAgentIdentity(ctx);
			const target = contextTargetAgent(query.namespace, query.params, identity.agentName);
			if (target === identity.agentName) return undefined;
			if (!router) throw new Error("Cross-agent notes are unavailable here");
			const result = await router(ctx, { sessionId: identity.sessionId, agentName: target,
				namespace: query.namespace, params: query.params }, signal);
			if (!result) throw new Error("Cross-agent notes owner is unavailable");
			return result;
		},
	};
}
