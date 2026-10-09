import type { AgentToolResult, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CachedResponse } from "./external-notes-protocol.ts";
import type { SharedContextResult } from "../context-sharing.ts";
import { contextAccountScope, contextAgentIdentity } from "./agent-identity.ts";
import { bindRemoteBackendScope, resolveRemoteContextProvider, remoteContextScope } from "./remote-scope.ts";

export async function projectNotesResponses(result: AgentToolResult<unknown>, responses: readonly CachedResponse[], callId: string,
	ctx: ExtensionContext, signal?: AbortSignal, relay = false): Promise<AgentToolResult<unknown>> {
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

/** Transport bytes become protected outputs only on the authenticated reader's current call. */
export async function projectSharedNotesResult(result: SharedContextResult, callId: string,
	ctx: ExtensionContext, signal?: AbortSignal): Promise<SharedContextResult> {
	const responses = result.details.externalNotesResponses;
	if (!responses?.length) return result;
	const { externalNotesResponses: _transport, ...details } = result.details;
	if (ctx.model?.api !== "openai-codex-responses") return { ...result, details,
		content: [...result.content, { type: "text", text: "Shared encrypted contents are unavailable on this model. Local results remain available; use a compatible model for remote contents." }] };
	const projected = await projectNotesResponses({ ...result, details }, responses.map(response => ({ ...response,
		bytes: Uint8Array.from(Buffer.from(response.bytesBase64, "base64")) })), callId, ctx, signal, true);
	return { ...result, ...projected, details: projected.details as SharedContextResult["details"] };
}
