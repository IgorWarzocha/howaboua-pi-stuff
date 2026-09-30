import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextWindowIdentity } from "./messages.ts";
import { contextAgentIdentity } from "./agent-identity.ts";

export function rewriteWindowPayload(
	payload: unknown,
	ctx: ExtensionContext,
	identity: ContextWindowIdentity | undefined,
): unknown {
	if (!identity || !isRecord(payload)) return payload;
	const metadata = requestMetadata(ctx, identity);
	const clientMetadata = isRecord(payload["client_metadata"])
		? payload["client_metadata"]
		: {};
	return {
		...payload,
		client_metadata: {
			...clientMetadata,
			session_id: metadata.session_id,
			thread_id: metadata.thread_id,
			agent_name: metadata.agent_name,
			"x-codex-window-id": metadata.window_id,
			"x-codex-turn-metadata": JSON.stringify(metadata),
		},
	};
}

export function rewriteWindowHeaders(
	headers: ProviderHeaders,
	ctx: ExtensionContext,
	identity: ContextWindowIdentity | undefined,
): void {
	if (!identity) return;
	const metadata = requestMetadata(ctx, identity);
	if (metadata.agent_name !== "/root") headers["response-session-id"] = metadata.session_id;
	headers["x-codex-window-id"] = metadata.window_id;
	headers["x-codex-turn-metadata"] = JSON.stringify(metadata);
}

function requestMetadata(ctx: ExtensionContext, identity: ContextWindowIdentity) {
	const sessionId = ctx.sessionManager.getSessionId();
	const agent = contextAgentIdentity(ctx);
	return {
		session_id: agent.sessionId,
		thread_id: sessionId,
		agent_name: agent.agentName,
		window_id: `${sessionId}:${identity.windowNumber}`,
		window_number: identity.windowNumber,
		context_window_id: identity.currentWindowId,
		request_kind: "turn",
		history_ingest_requested: true,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
