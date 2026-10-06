import { randomUUID } from "node:crypto";
import { arch, release, type } from "node:os";

/** A fresh, tool-less review thread, never the parent's transport identity. */
export function reviewerWire(parentThreadId: string, parentResponseId: string) {
	const threadId = randomUUID();
	const turnId = randomUUID();
	const windowId = `${threadId}:0`;
	const turnMetadata = JSON.stringify({
		session_id: threadId,
		thread_id: threadId,
		agent_name: "guardian",
		turn_id: turnId,
		window_id: windowId,
		window_number: 0,
		context_window_id: randomUUID(),
		request_kind: "turn",
		turn_trigger: "guardian_review",
		parent_thread_id: parentThreadId,
		sandbox: "none",
		sandbox_mode: "danger-full-access",
		auto_review_enabled: false,
		node_repl_auto_review_required: false,
		node_repl_disabled: true,
		turn_started_at_unix_ms: Date.now(),
		history_ingest_requested: false,
		analytics_enabled: false,
	});
	return {
		threadId,
		promptCacheKey: `guardian:${parentThreadId}`,
		clientMetadata: {
			session_id: threadId,
			thread_id: threadId,
			turn_id: turnId,
			"x-codex-window-id": windowId,
			"x-codex-turn-metadata": turnMetadata,
			"x-codex-parent-thread-id": parentThreadId,
			"x-openai-subagent": "guardian",
			parent_response_id: parentResponseId,
		},
		headers(outgoing: Headers): Headers {
			// Preserve actual configured headers, including residency. Parent routing,
			// attestation, tracing and feature claims do not belong to this fresh
			// one-shot standard-Responses thread.
			const headers = new Headers(outgoing);
			for (const key of [
				"x-codex-routing-hint",
				"x-codex-turn-state",
				"x-codex-beta-features",
				"x-oai-attestation",
				"x-codex-installation-id",
				"x-openai-internal-codex-responses-lite",
				"x-openai-memgen-request",
				"response-session-id",
				"openai-beta",
				"x-responsesapi-include-timing-metrics",
				"x-codex-inference-call-id",
				"traceparent",
				"tracestate",
				"baggage",
			]) {
				headers.delete(key);
			}
			headers.set("originator", "codex_cli_rs");
			// Identify the compatibility client without claiming an installed Rust build.
			headers.set(
				"user-agent",
				`codex_cli_rs (${type()} ${release()}; ${arch()}) pi-codex-guardian`.replace(
					/[^\x20-\x7e]/g,
					"_",
				),
			);
			headers.set("accept", "text/event-stream");
			headers.set("content-type", "application/json");
			headers.set("x-codex-guardian", "reviewer");
			headers.set("x-openai-subagent", "guardian");
			headers.set("session-id", threadId);
			headers.set("thread-id", threadId);
			headers.set("x-client-request-id", threadId);
			headers.set("x-codex-window-id", windowId);
			headers.set("x-codex-turn-metadata", turnMetadata);
			headers.set("x-codex-parent-thread-id", parentThreadId);
			return headers;
		},
	};
}
