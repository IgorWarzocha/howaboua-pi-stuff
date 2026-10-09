import type { NotesBridge } from "./external-notes-protocol.ts";
import type { ContextRouter } from "../context-sharing.ts";
import { contextAgentIdentity, contextTargetAgent } from "./agent-identity.ts";
import { lookupRemoteHistoryNotes } from "./history-notes.ts";
import { projectNotesResponses, projectSharedNotesResult } from "./notes-response-projection.ts";

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
		projectResult: projectNotesResponses,
		async route(query, callId, ctx, signal) {
			const identity = contextAgentIdentity(ctx);
			const target = contextTargetAgent(query.namespace, query.params, identity.agentName);
			if (target === identity.agentName) return undefined;
			if (!router) throw new Error("Cross-agent notes are unavailable here");
			const result = await router(ctx, { sessionId: identity.sessionId, agentName: target,
				namespace: query.namespace, params: query.params }, signal);
			if (!result) throw new Error("Cross-agent notes owner is unavailable");
			return projectSharedNotesResult(result, callId, ctx, signal);
		},
	};
}
