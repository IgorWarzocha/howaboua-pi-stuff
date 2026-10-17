import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { createCodexRequestTiming, type CodexAttemptTiming } from "./diagnostic-timing.ts";
import { codexRequestDiagnostics } from "./diagnostic-request.ts";
import { nextWebSocketRequestOrdinal, webSocketDiagnosticId } from "./websocket-connection.ts";
import { normalizeTimeoutMs } from "./sse.ts";
import { buildCachedWebSocketRequestBody } from "./websocket-continuation.ts";
import { serializeCodexRequest } from "./request-serialization.ts";
import { acquireWebSocket, parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket.ts";
import { assertSuccessfulCodexOutput, assertSuccessfulCodexStatus, mapCodexEvents, processMappedCodexResponsesStream } from "./stream-events.ts";
import type { CachedWebSocketRequestBodyResult, CanonicalHistoryDecision, CodexDiagnosticsLane, CodexDiagnosticsSink, CodexPrewarmDiagnostics, CodexPrewarmResult, OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import type { CodexTurnState } from "./turn-state.ts";
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS } from "./constants.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";
import { recordCanonicalSessionResponse, type CanonicalSessionToken } from "./session-continuity.ts";

export function codexCacheKeepaliveSocketSessionId(sessionId: string): string {
	return `${sessionId}:cache-keepalive`;
}

export async function processWebSocketStream<TApi extends Api>(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	output: AssistantMessage,
	stream: Pick<AssistantMessageEventStream, "push">,
	model: Model<TApi>,
	accountId: string,
	onStart: () => void,
	options: OpenAICodexStreamOptions | undefined,
	turnState?: CodexTurnState,
	diagnostics?: { lane: Exclude<CodexDiagnosticsLane, "prewarm">; attempt: number; record: CodexDiagnosticsSink; requestId: string; timing: CodexAttemptTiming } | undefined,
	canonical?: {
		reconstructedRequestBody: ResponsesBody;
		token?: CanonicalSessionToken | undefined;
		decision?: CanonicalHistoryDecision | undefined;
	} | undefined,
): Promise<void> {
	let streamStarted = false;
	const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, "timeoutMs");
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");

	const { socket, entry, release, reused, socketAgeMs } = await acquireWebSocket(url, headers, options?.sessionId, accountId, options?.signal, websocketConnectTimeoutMs, options?.env, diagnostics?.record);
	// Checkpoint validation happens after streaming; retire its server-side response state.
	let keepConnection = !options?.canonicalCompaction;
	let released = false;
	const responseItems: unknown[] = [];
	const transport = (options as { transport?: string | undefined } | undefined)?.transport ?? "auto";
	const useCachedContext = transport === "websocket-cached" || transport === "auto";
	// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
	// WebSocket continuation still works via connection-scoped previous_response_id state.
	const fullBody = body;
	const cachedRequest: CachedWebSocketRequestBodyResult = useCachedContext && entry
		? buildCachedWebSocketRequestBody(entry.continuation, fullBody)
		: { body: fullBody, decision: useCachedContext ? "no_session_cache_entry" : "disabled" };
	const requestBody = cachedRequest.body;
	const recordDiagnostics = noThrowCodexDiagnosticsSink(diagnostics?.record);
	if (options?.compactionDiagnostics) {
		Object.assign(options.compactionDiagnostics, {
			transport: "websocket",
			continuation: cachedRequest.decision,
			continuationMismatch: cachedRequest.mismatch,
			previousResponseId: Boolean(requestBody.previous_response_id),
			fullInputItems: fullBody.input.length,
			sentInputItems: requestBody.input.length,
		});
	}

	const releaseOnce = (releaseOptions?: { keep?: boolean | undefined }) => {
		if (released) return;
		released = true;
		release(releaseOptions);
	};

	try {
		const socketRequestOrdinal = nextWebSocketRequestOrdinal(socket);
		if (diagnostics && recordDiagnostics) {
			recordDiagnostics({
				type: "request",
				lane: diagnostics.lane,
				transport: "websocket",
				attempt: diagnostics.attempt,
				requestId: diagnostics.requestId,
				requestMetadata: codexRequestDiagnostics(fullBody, headers, !reused),
				fullInputItems: fullBody.input.length,
				sentInputItems: requestBody.input.length,
				model: fullBody.model,
				socketReused: reused,
				socketId: webSocketDiagnosticId(socket),
				socketAgeMs,
				socketRequestOrdinal,
				socketLane: "main",
				continuation: cachedRequest.decision,
				...(cachedRequest.mismatch ? { continuationMismatch: cachedRequest.mismatch } : {}),
				...(entry?.continuation ? {
					continuationBaselineInputItems: entry.continuation.lastRequestBody.input.length,
					continuationBaselineResponseItems: entry.continuation.lastResponseItems.length,
				} : {}),
				...(canonical?.decision ? { canonicalHistory: canonical.decision } : {}),
				...(options?.compactionDiagnostics ? { compaction: structuredClone(options.compactionDiagnostics) } : {}),
				previousResponseId: Boolean(requestBody.previous_response_id),
			});
		}
		diagnostics?.timing.sent();
		socket.send(serializeCodexRequest({ type: "response.create", ...requestBody }));
		await processMappedCodexResponsesStream(
			startWebSocketOutputOnFirstEvent(
				mapCodexEvents(
					parseWebSocket(socket, options?.signal, idleTimeoutMs, (value) => turnState?.capture(value)),
					output,
					(event) => {
						diagnostics?.timing.observe(event);
						return options?.onProviderStreamEvent?.(event, model);
					},
				),
				() => {
					if (!streamStarted) {
						streamStarted = true;
						onStart();
					}
				},
			),
			output,
			stream,
			model,
			{
				...options,
				onOutputItemDone: (item) => responseItems.push(item),
			},
		);
		if (options?.signal?.aborted) {
			keepConnection = false;
		} else {
			assertSuccessfulCodexOutput(output);
			for (const item of responseItems) options?.onOutputItemDone?.(item);
			// Compaction callers validate and store checkpoints. Until then its output
			// must not replace the sampling baseline, including on invalid-output failure.
			if (!options?.canonicalCompaction && useCachedContext && entry && output.responseId) {
				entry.continuation = {
					lastRequestBody: fullBody,
					lastResponseId: output.responseId,
					lastResponseItems: responseItems,
				};
			}
			// A transient socket means another request already owns this session lane.
			// Its concurrent history has no canonical ordering, so only the retained
			// cached lane may advance the baseline used by later compaction.
			if (entry && !options?.canonicalCompaction) {
				recordCanonicalSessionResponse({
					sessionId: options?.sessionId,
					url,
					accountId,
					requestBody: fullBody,
					reconstructedRequestBody: canonical?.reconstructedRequestBody,
					responseItems,
					token: canonical?.token,
				});
			}
		}
		releaseOnce({ keep: keepConnection });
	} catch (error) {
		if (entry) entry.continuation = undefined;
		keepConnection = false;
		releaseOnce({ keep: false });
		throw error;
	} finally {
		releaseOnce({ keep: keepConnection });
	}
}

export async function prewarmWebSocket<TApi extends Api>(
	model: Model<TApi>,
	url: string,
	body: ResponsesBody,
	headers: Headers,
	accountId: string,
	options: OpenAICodexStreamOptions,
	turnState?: CodexTurnState,
	diagnostics?: CodexDiagnosticsSink | undefined,
	preserveContinuation = false,
	prewarm: CodexPrewarmDiagnostics = { kind: "ordinary" },
	generate = false,
	retainSocket = true,
): Promise<CodexPrewarmResult> {
	const recordDiagnostics = noThrowCodexDiagnosticsSink(diagnostics);
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
	const requestTiming = createCodexRequestTiming(recordDiagnostics);
	const timing = requestTiming.start("prewarm", "websocket", generate);
	const socketSessionId = preserveContinuation && options.sessionId
		? codexCacheKeepaliveSocketSessionId(options.sessionId)
		: options.sessionId;
	const socketLane = preserveContinuation ? "keepalive" : "main";
	const { socket, entry, release, reused, socketAgeMs } = await acquireWebSocket(url, headers, socketSessionId, accountId, options.signal, websocketConnectTimeoutMs, options.env, recordDiagnostics).catch(error => {
		timing.finish(options.signal?.aborted ? "aborted" : "failed");
		recordDiagnostics?.({ type: "failure", lane: "prewarm", transport: "websocket", requestId: requestTiming.requestId, failure: codexDiagnosticsFailure(error) });
		throw error;
	});
	let keepConnection = true;
	const responseItems: unknown[] = [];
	let responseId: string | undefined;
	let responseStatus: string | undefined;
	let usage: CodexPrewarmResult["usage"];
	const idleTimeoutMs = normalizeTimeoutMs(options.timeoutMs ?? options.websocketConnectTimeoutMs ?? DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, "timeoutMs");
	try {
		if (options.signal?.aborted) throw new Error("Request was aborted");
		const cachedRequest: CachedWebSocketRequestBodyResult = prewarm.kind === "compaction" && !preserveContinuation && !generate && entry
			? buildCachedWebSocketRequestBody(entry.continuation, body)
			: { body, decision: "disabled" };
		const requestBody = cachedRequest.body;
		// Acquisition validates the route, credentials and live socket. Keep the
		// existing baseline; the real request still validates its exact continuation.
		if (!preserveContinuation && !generate && reused && entry?.continuation
			&& (prewarm.kind === "ordinary" || (cachedRequest.decision === "delta" && requestBody.input.length === 0))) {
			recordDiagnostics?.({ type: "prewarm-ready", requestId: requestTiming.requestId, transport: "websocket", socketId: webSocketDiagnosticId(socket), socketReused: reused, socketAgeMs, socketLane, prewarm });
			return { socketReused: reused };
		}
		const socketRequestOrdinal = nextWebSocketRequestOrdinal(socket);
		recordDiagnostics?.({
			type: "request",
			lane: "prewarm",
			transport: "websocket",
			attempt: timing.attempt,
			requestId: requestTiming.requestId,
			requestMetadata: codexRequestDiagnostics(body, headers, !reused),
			fullInputItems: body.input.length,
			sentInputItems: requestBody.input.length,
			model: body.model,
			socketReused: reused,
			socketId: webSocketDiagnosticId(socket),
			socketAgeMs,
			socketRequestOrdinal,
			socketLane,
			prewarm,
			continuation: cachedRequest.decision,
			...(cachedRequest.mismatch ? { continuationMismatch: cachedRequest.mismatch } : {}),
			...(entry?.continuation ? {
				continuationBaselineInputItems: entry.continuation.lastRequestBody.input.length,
				continuationBaselineResponseItems: entry.continuation.lastResponseItems.length,
			} : {}),
			previousResponseId: Boolean(requestBody.previous_response_id),
		});
		timing.sent();
		socket.send(serializeCodexRequest({ type: "response.create", ...requestBody, ...(generate ? {} : { generate: false }) }));
		for await (const event of mapCodexEvents(parseWebSocket(socket, options.signal, idleTimeoutMs, (value) => {
			if (!preserveContinuation) turnState?.capturePrewarm(value);
		}), undefined, (event) => { timing.observe(event); return options.onProviderStreamEvent?.(event, model); })) {
			if (event.type === "response.created" && event.response?.id) responseId = event.response.id;
			if (event.type === "response.output_item.done" && event.item) responseItems.push(event.item);
			if (event.type === "response.completed") {
				if (event.response?.id) responseId = event.response.id;
				responseStatus = event.response?.status;
				const responseUsage = event.response?.usage;
				if (responseUsage) {
					const cacheRead = responseUsage.input_tokens_details?.cached_tokens ?? 0;
					const cacheWrite = responseUsage.input_tokens_details?.cache_write_tokens ?? 0;
					usage = {
						inputTokens: Math.max(0, (responseUsage.input_tokens ?? 0) - cacheRead - cacheWrite),
						cachedInputTokens: cacheRead,
						cacheWriteInputTokens: cacheWrite,
						...(generate ? { outputTokens: responseUsage.output_tokens ?? 0 } : {}),
					};
				}
			}
		}
		assertSuccessfulCodexStatus(responseStatus);
		if (!preserveContinuation && entry && responseId) {
			entry.continuation = { lastRequestBody: body, lastResponseId: responseId, lastResponseItems: responseItems };
		}
		recordDiagnostics?.({
			type: "prewarm-ready",
			socketId: webSocketDiagnosticId(socket),
			requestId: requestTiming.requestId,
			transport: "websocket",
			socketReused: reused,
			socketAgeMs,
			socketLane,
			prewarm,
			...(usage ? { usage } : {}),
		});
		timing.finish(options.signal?.aborted ? "aborted" : "completed");
		return { socketReused: reused, ...(usage ? { usage } : {}) };
	} catch (error) {
		timing.finish(options.signal?.aborted ? "aborted" : "failed");
		keepConnection = false;
		recordDiagnostics?.({
			type: "failure",
			lane: "prewarm",
			requestId: requestTiming.requestId,
			transport: "websocket",
			failure: codexDiagnosticsFailure(error),
		});
		throw error;
	} finally {
		release({ keep: keepConnection && retainSocket });
	}
}
