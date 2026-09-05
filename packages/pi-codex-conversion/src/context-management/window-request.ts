import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextWindowIdentity } from "./messages.ts";

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
	headers["x-codex-window-id"] = metadata.window_id;
	headers["x-codex-turn-metadata"] = JSON.stringify(metadata);
}

function requestMetadata(ctx: ExtensionContext, identity: ContextWindowIdentity) {
	const sessionId = ctx.sessionManager.getSessionId();
	return {
		session_id: sessionId,
		thread_id: sessionId,
		agent_name: "/root",
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
