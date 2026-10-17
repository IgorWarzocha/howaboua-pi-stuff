import { isDeepStrictEqual } from "node:util";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ProviderHeaders } from "@earendil-works/pi-ai";

const RELATIONSHIP_ENTRY = "codex-agent-relationship";
const PARENT_HEADER = "x-codex-parent-thread-id";
const SUBAGENT_HEADER = "x-openai-subagent";
const TURN_METADATA = "x-codex-turn-metadata";

/** Parent linkage and classification are independent of context sharing. */
export interface CodexAgentRelationship {
	parentThreadId?: string;
	subagentKind?: string;
	/** Optional routing affinity, not a native thread or shared-history identity. */
	cacheAffinityId?: string;
}

function parseRelationship(input: unknown): CodexAgentRelationship {
	if (!input || typeof input !== "object") throw new Error("Invalid Codex agent relationship");
	const value = input as CodexAgentRelationship;
	for (const field of [value.parentThreadId, value.subagentKind, value.cacheAffinityId]) {
		if (field !== undefined && (typeof field !== "string" || !/^[\x21-\x7e]+$/.test(field)))
			throw new Error("Invalid Codex agent relationship");
	}
	if (value.cacheAffinityId && value.cacheAffinityId.length > 64)
		throw new Error("Codex cache affinity must not exceed 64 characters");
	if (!value.parentThreadId && !value.subagentKind && !value.cacheAffinityId) throw new Error("Empty Codex agent relationship");
	return { ...(value.parentThreadId ? { parentThreadId: value.parentThreadId } : {}),
		...(value.subagentKind ? { subagentKind: value.subagentKind } : {}),
		...(value.cacheAffinityId ? { cacheAffinityId: value.cacheAffinityId } : {}) };
}

export function codexAgentRelationship(ctx: Pick<ExtensionContext, "sessionManager">): CodexAgentRelationship | undefined {
	let relationship: CodexAgentRelationship | undefined;
	for (const entry of ctx.sessionManager.getEntries()) {
		if (entry.type !== "custom" || entry.customType !== RELATIONSHIP_ENTRY) continue;
		const value = entry.data as { threadId?: unknown } | undefined;
		// Resume preserves the native thread; forks do not inherit worker classification.
		if (value?.threadId !== ctx.sessionManager.getSessionId()) continue;
		if (relationship) throw new Error("Conflicting persisted Codex agent relationships");
		relationship = parseRelationship(value);
	}
	return relationship;
}

export function bindCodexAgentRelationship(pi: ExtensionAPI, ctx: ExtensionContext, input: unknown): CodexAgentRelationship {
	const relationship = parseRelationship(input);
	if (relationship.parentThreadId === ctx.sessionManager.getSessionId()) throw new Error("An agent cannot be its own parent");
	const current = codexAgentRelationship(ctx);
	if (current) {
		if (!isDeepStrictEqual(current, relationship)) throw new Error("An existing agent relationship cannot be rebound");
		return current;
	}
	if (!ctx.isIdle()) throw new Error("Agent relationship requires an idle Pi session");
	pi.appendEntry(RELATIONSHIP_ENTRY, { ...relationship, threadId: ctx.sessionManager.getSessionId() });
	return relationship;
}

export function relationshipTurnMetadata(ctx: Pick<ExtensionContext, "sessionManager">): Record<string, string> {
	const relationship = codexAgentRelationship(ctx);
	return { ...(relationship?.parentThreadId ? { parent_thread_id: relationship.parentThreadId } : {}),
		...(relationship?.subagentKind ? { subagent_kind: relationship.subagentKind } : {}) };
}

export function rewriteRelationshipHeaders(headers: ProviderHeaders, ctx: ExtensionContext): void {
	const relationship = codexAgentRelationship(ctx);
	if (relationship?.parentThreadId) headers[PARENT_HEADER] = relationship.parentThreadId;
	if (relationship?.subagentKind) headers[SUBAGENT_HEADER] = relationship.subagentKind;
	if (relationship?.cacheAffinityId) headers["session-id"] = relationship.cacheAffinityId;
	if (relationship) headers[TURN_METADATA] = mergeTurnMetadata(headers[TURN_METADATA], ctx);
}

function mergeTurnMetadata(existing: unknown, ctx: ExtensionContext): string {
	const metadata: unknown = typeof existing === "string" ? JSON.parse(existing) : {};
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) throw new Error("Invalid Codex turn metadata");
	return JSON.stringify({ ...metadata, ...relationshipTurnMetadata(ctx) });
}

export function rewriteRelationshipPayload(payload: unknown, ctx: ExtensionContext): unknown {
	const relationship = codexAgentRelationship(ctx);
	if (!relationship || !payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
	const body = payload as Record<string, unknown>;
	const existing = body["client_metadata"];
	const metadata = existing && typeof existing === "object" && !Array.isArray(existing) ? existing as Record<string, unknown> : {};
	return {
		...body,
		...(relationship.cacheAffinityId ? { prompt_cache_key: relationship.cacheAffinityId } : {}),
		client_metadata: {
			...metadata,
			[TURN_METADATA]: mergeTurnMetadata(metadata[TURN_METADATA], ctx),
			...(relationship.parentThreadId ? { [PARENT_HEADER]: relationship.parentThreadId } : {}),
			...(relationship.subagentKind ? { [SUBAGENT_HEADER]: relationship.subagentKind } : {}),
		},
	};
}
