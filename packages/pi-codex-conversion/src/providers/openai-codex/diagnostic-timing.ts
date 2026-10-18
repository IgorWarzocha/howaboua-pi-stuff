import type { CodexDiagnosticsLane, CodexDiagnosticsSink, CodexDiagnosticsTransport, StreamEventShape } from "./types.ts";

// Backend names describe backend boundaries, not user-visible token latency.
const NUMERIC_TIMING_KEYS = [
	"responsesapi_chat_runner_streaming_token_batch_size", "websocket_output_text_delta_tbt_ms", "websocket_output_text_delta_count",
	"pre_inference_ms", "client_tool_pause_total_ms", "total_turn_time_s", "xapi_validation_time_s",
	"num_engine_calls", "engine_total_prompt_tokens_total", "first_sampled_message_ttft_ms",
	"num_sampled_tokens_total", "engine_queue_max_ms", "engine_iapi_ttft_total_ms",
	"engine_service_ttft_total_ms", "engine_iapi_sampling_total_ms", "engine_service_sampling_total_ms",
	"engine_iapi_inference_total_ms", "engine_service_inference_total_ms", "engine_iapi_tbt_across_engine_calls_ms",
	"engine_service_tbt_across_engine_calls_ms", "engine_service_minus_iapi_tbt_across_engine_calls_ms",
	"engine_service_total_ms", "responsesapi_duration_excl_client_tools_ms",
	"responses_duration_excl_engine_wait_and_sampling_ms", "responses_duration_excl_engine_wait_and_sampling_iapi_ms",
	"responses_duration_excl_engine_and_client_tool_time_ms",
] as const;

const STRING_TIMING_VALUES = {
	"timing_scope": ["logical_turn", "response"],
	"critical_path.scope": ["response"],
	"critical_path.coverage": ["missing_harness_boundary"],
	"critical_path.boundary_type": ["missing_harness_boundary"],
} as const;
export const CODEX_BACKEND_TIMING_KEYS = [...NUMERIC_TIMING_KEYS, ...Object.keys(STRING_TIMING_VALUES)];

function count(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

// Native session IDs, never shared cache-affinity IDs. Retained across socket,
// context-window and diagnostics changes; deliberately not persisted on resume.
const sessionRequestOrdinals = new Map<string, number>();
const requestCounterProcessId = crypto.randomUUID();

export function createCodexRequestTiming(record: CodexDiagnosticsSink | undefined, now = () => performance.now(), sessionId?: string) {
	if (!record) now = () => 0;
	const requestId = record ? crypto.randomUUID() : "";
	const requestStart = now();
	let attempt = 0;
	let sessionRequestOrdinal: number | undefined;
	return {
		requestId,
		get sessionRequestOrdinal() { return sessionRequestOrdinal; },
		requestCounterProcessId,
		get nextAttempt() { return attempt + 1; },
		start(lane: CodexDiagnosticsLane, transport: CodexDiagnosticsTransport, measureOutput = true) {
			if (lane !== "prewarm" && sessionId && sessionRequestOrdinal === undefined) {
				sessionRequestOrdinal = (sessionRequestOrdinals.get(sessionId) ?? 0) + 1;
				sessionRequestOrdinals.set(sessionId, sessionRequestOrdinal);
			}
			const started = now();
			const attemptNumber = ++attempt;
			let sendMs: number | null = null;
			let firstEventMs: number | null = null;
			let firstVisibleTextMs: number | null = null;
			let completionMs: number | null = null;
			let outputTokens: number | null = null;
			let reasoningTokens: number | null = null;
			let finished = false;
			const backend: Record<string, number | string | null> = record
				? Object.fromEntries(CODEX_BACKEND_TIMING_KEYS.map(key => [key, "missing"])) : {};
			return {
				attempt: attemptNumber,
				sent() { sendMs = now() - started; },
				observe(value: unknown) {
					if (!record) return;
					if (!value || typeof value !== "object") return;
					const event = value as StreamEventShape;
					const elapsed = now() - started;
					firstEventMs ??= elapsed;
					if (event.type === "response.output_text.delta" && typeof event["delta"] === "string" && event["delta"].length > 0) firstVisibleTextMs ??= elapsed;
					if (event.type === "response.completed" || event.type === "response.done" || event.type === "response.incomplete" || event.type === "response.failed") {
						completionMs = elapsed;
						const usage = event.response?.usage;
						outputTokens = measureOutput ? count(usage?.output_tokens) : null;
						reasoningTokens = measureOutput ? count(usage?.output_tokens_details?.reasoning_tokens) : null;
					}
					if (event.type === "responsesapi.websocket_timing") {
						const metrics = event["timing_metrics"];
						if (!metrics || typeof metrics !== "object") return;
						for (const key of NUMERIC_TIMING_KEYS) {
							const value = (metrics as Record<string, unknown>)[key];
							backend[key] = value === null ? null : typeof value === "number" && Number.isFinite(value) ? value : "missing";
						}
						for (const [key, allowed] of Object.entries(STRING_TIMING_VALUES)) {
							const [root, nested] = key.split(".");
							let value = (metrics as Record<string, unknown>)[root ?? ""];
							if (nested) value = value && typeof value === "object" ? (value as Record<string, unknown>)[nested] : undefined;
							backend[key] = value === undefined ? "missing" : value === null ? null : typeof value === "string" && (allowed as readonly string[]).includes(value) ? value : "other";
						}
					}
				},
				finish(outcome: "completed" | "failed" | "aborted") {
					if (finished) return;
					finished = true;
					const ended = now();
					const duration = completionMs !== null && sendMs !== null ? completionMs - sendMs : 0;
					record?.({ type: "timing", lane, transport, requestId, sessionRequestOrdinal, requestCounterProcessId, attempt: attemptNumber, outcome,
						requestElapsedMs: ended - requestStart, attemptElapsedMs: ended - started,
						sendMs, firstEventMs, firstVisibleTextMs, completionMs, outputTokens, reasoningTokens,
						outputTokensPerSecond: outcome === "completed" && outputTokens !== null && duration > 0 ? outputTokens * 1000 / duration : null, backend });
				},
			};
		},
	};
}

export type CodexAttemptTiming = ReturnType<ReturnType<typeof createCodexRequestTiming>["start"]>;
