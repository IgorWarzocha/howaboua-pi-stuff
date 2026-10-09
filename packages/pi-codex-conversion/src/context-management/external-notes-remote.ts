import type { NotesBridge, CachedResponse } from "./external-notes-protocol.ts";
import type { ContextRouter } from "../context-sharing.ts";
import { contextAccountScope, contextAgentIdentity, contextTargetAgent } from "./agent-identity.ts";
import { lookupRemoteHistoryNotes } from "./history-notes.ts";
import { bindRemoteBackendScope, resolveRemoteContextProvider, remoteContextScope } from "./remote-scope.ts";

/** Provider services remain PCC-owned; continuity and the response cache do not. */
export function createExternalNotesRemoteService(router?: ContextRouter): Pick<NotesBridge,
	"lookup" | "canProject" | "projectResult" | "agentName" | "route"> {
	const project: NonNullable<NotesBridge["projectResult"]> = async (result, responses, callId, ctx, signal) => projectResponses(result, responses, callId, ctx, signal);
	async function projectResponses(result: Parameters<typeof project>[0], responses: readonly CachedResponse[], callId: string,
		ctx: Parameters<typeof project>[3], signal?: AbortSignal, relay = false): ReturnType<typeof project> {
		signal?.throwIfAborted();
		if (!callId) throw new Error("Protected delivery requires a current tool call");
		if (!responses.length) return { ...result, content: result.content.map(part => ({ ...part })) };
		const identity = contextAgentIdentity(ctx);
		const before = JSON.stringify([identity, ctx.model]);
		const provider = await resolveRemoteContextProvider(ctx);
		if (before !== JSON.stringify([contextAgentIdentity(ctx), ctx.model])) throw new Error("Context changed during authentication; retry in the original session");
		const scope = remoteContextScope(identity, provider.accountId, provider.baseUrl);
		const source = responses[0]!.source;
		if (relay) {
			const provenance: unknown = JSON.parse(source);
			if (!provenance || typeof provenance !== "object" || !("accountScope" in provenance) || provenance.accountScope !== contextAccountScope(provider.accountId)
				|| !("baseUrl" in provenance) || provenance.baseUrl !== provider.baseUrl
				|| !("threadId" in provenance) || typeof provenance.threadId !== "string" || !provenance.threadId
				|| !("sessionId" in provenance) || typeof provenance.sessionId !== "string" || !provenance.sessionId
				|| !("agentName" in provenance) || typeof provenance.agentName !== "string" || !/^\/root(?:\/[a-zA-Z0-9_-]+)*$/.test(provenance.agentName))
				throw new Error("Shared protected response belongs to a different account or backend");
		} else if (source !== scope) throw new Error("Cached response belongs to a different context");
		signal?.throwIfAborted();
		const outputs = responses.map((response, index) => {
			if (response.source !== source) throw new Error("Protected responses have different owners");
			const envelope: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
			if (!envelope || typeof envelope !== "object" || !("encrypted_output" in envelope) || typeof envelope.encrypted_output !== "string" || !envelope.encrypted_output.trim())
				throw new Error("Cached response contains no protected output");
			const hint = "attachment_hint" in envelope && typeof envelope.attachment_hint === "string" ? envelope.attachment_hint : undefined;
			return { resultId: `${callId}:${index}`, name: response.query.namespace + (hint ? `; ${hint}` : ""), encryptedOutput: envelope.encrypted_output };
		});
		const codexHistoryNotes = { cachedOutputs: outputs };
		bindRemoteBackendScope(codexHistoryNotes, source, relay ? scope : undefined);
		return { ...result, content: result.content.map(part => ({ ...part })), details: {
			...(result.details && typeof result.details === "object" ? result.details : {}), codexHistoryNotes } };
	}
	return {
		canProject: ctx => ctx.model?.api === "openai-codex-responses",
		agentName: ctx => contextAgentIdentity(ctx).agentName,
		async lookup(query, ctx, signal) {
			const response = await lookupRemoteHistoryNotes(query.namespace, query.params, ctx, signal);
			return [{ query, ...response, fetchedAt: Date.now(), coverage: "unknown" }];
		},
		projectResult: project,
		async route(query, callId, ctx, signal) {
			const identity = contextAgentIdentity(ctx);
			const target = contextTargetAgent(query.namespace, query.params, identity.agentName);
			if (target === identity.agentName) return undefined;
			if (!router) throw new Error("Cross-agent notes are unavailable here");
			const result = await router(ctx, { sessionId: identity.sessionId, agentName: target,
				namespace: query.namespace, params: query.params }, signal);
			if (!result) throw new Error("Cross-agent notes owner is unavailable");
			const responses = result.details.externalNotesResponses;
			if (!responses?.length) return result;
			const { externalNotesResponses: _transport, ...details } = result.details;
			if (ctx.model?.api !== "openai-codex-responses") return { ...result, details,
				content: [...result.content, { type: "text", text: "Shared encrypted contents are unavailable on this model. Local results remain available; use a compatible model for remote contents." }] };
			return projectResponses({ ...result, details }, responses.map(response => ({ ...response,
				bytes: Uint8Array.from(Buffer.from(response.bytesBase64, "base64")) })), callId, ctx, signal, true);
		},
	};
}
