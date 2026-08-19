import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { normalizeTimeoutMs } from "./sse.ts";
import { buildCachedWebSocketRequestBody } from "./websocket-continuation.ts";
import { acquireWebSocket, parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket.ts";
import { assertSuccessfulCodexOutput, assertSuccessfulCodexStatus, mapCodexEvents, processMappedCodexResponsesStream } from "./stream-events.ts";
import type { CachedWebSocketRequestBodyResult, CanonicalHistoryDecision, CodexDiagnosticsLane, CodexDiagnosticsSink, CodexPrewarmResult, OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import type { CodexTurnState } from "./turn-state.ts";
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS } from "./constants.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";
import { recordCanonicalSessionResponse, type CanonicalSessionToken } from "./session-continuity.ts";

export async function processWebSocketStream<TApi extends Api>(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	accountId: string,
	onStart: () => void,
	options: OpenAICodexStreamOptions | undefined,
	turnState?: CodexTurnState,
	diagnostics?: { lane: Exclude<CodexDiagnosticsLane, "prewarm">; attempt: number; record: CodexDiagnosticsSink } | undefined,
	canonical?: {
		reconstructedRequestBody: ResponsesBody;
		token?: CanonicalSessionToken | undefined;
		decision?: CanonicalHistoryDecision | undefined;
	} | undefined,
): Promise<void> {
	let streamStarted = false;
	const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, "timeoutMs");
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");

	const { socket, entry, release, reused } = await acquireWebSocket(url, headers, options?.sessionId, accountId, options?.signal, websocketConnectTimeoutMs, options?.env);
	let keepConnection = true;
	let released = false;
	const responseItems: unknown[] = [];
	const transport = (options as { transport?: string | undefined } | undefined)?.transport ?? "auto";
	const useCachedContext = transport === "websocket-cached" || transport === "auto";
	// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
	// WebSocket continuation still works via connection-scoped previous_response_id state.
	const fullBody = body;
	const cachedRequest = useCachedContext && entry
		? buildCachedWebSocketRequestBody(entry.continuation, fullBody)
		: { body: fullBody, decision: useCachedContext ? "no_session_cache_entry" : "disabled" } satisfies CachedWebSocketRequestBodyResult;
	const requestBody = cachedRequest.body;
	const recordDiagnostics = noThrowCodexDiagnosticsSink(diagnostics?.record);
	if (options?.compactionDiagnostics) {
		Object.assign(options.compactionDiagnostics, {
			transport: "websocket",
			continuation: cachedRequest.decision,
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
		if (diagnostics && recordDiagnostics) {
			recordDiagnostics({
				type: "request",
				lane: diagnostics.lane,
				transport: "websocket",
				attempt: diagnostics.attempt,
				fullInputItems: fullBody.input.length,
				sentInputItems: requestBody.input.length,
				model: fullBody.model,
				socketReused: reused,
				continuation: cachedRequest.decision,
				...(canonical?.decision ? { canonicalHistory: canonical.decision } : {}),
				...(options?.compactionDiagnostics ? { compaction: structuredClone(options.compactionDiagnostics) } : {}),
				previousResponseId: Boolean(requestBody.previous_response_id),
			});
		}
		socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
		await processMappedCodexResponsesStream(
			startWebSocketOutputOnFirstEvent(
				mapCodexEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs, (value) => turnState?.capture(value)), output),
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
			if (useCachedContext && entry && output.responseId) {
				entry.continuation = {
					lastRequestBody: fullBody,
					lastResponseId: output.responseId,
					lastResponseItems: responseItems,
				};
			}
			// A transient socket means another request already owns this session lane.
			// Its concurrent history has no canonical ordering, so only the retained
			// cached lane may advance the baseline used by later compaction.
			if (entry) {
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

export async function prewarmWebSocket(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	accountId: string,
	options: OpenAICodexStreamOptions,
	turnState?: CodexTurnState,
	diagnostics?: CodexDiagnosticsSink | undefined,
	preserveContinuation = false,
): Promise<CodexPrewarmResult> {
	const recordDiagnostics = noThrowCodexDiagnosticsSink(diagnostics);
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
	const socketSessionId = preserveContinuation ? `${options.sessionId}:cache-keepalive` : options.sessionId;
	const { socket, entry, release, reused } = await acquireWebSocket(url, headers, socketSessionId, accountId, options.signal, websocketConnectTimeoutMs, options.env);
	let keepConnection = true;
	const responseItems: unknown[] = [];
	let responseId: string | undefined;
	let responseStatus: string | undefined;
	let usage: CodexPrewarmResult["usage"];
	const idleTimeoutMs = normalizeTimeoutMs(options.timeoutMs ?? options.websocketConnectTimeoutMs ?? DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, "timeoutMs");
	try {
		recordDiagnostics?.({
			type: "request",
			lane: "prewarm",
			transport: "websocket",
			attempt: 1,
			fullInputItems: body.input.length,
			sentInputItems: body.input.length,
			socketReused: reused,
			previousResponseId: Boolean(body.previous_response_id),
		});
		socket.send(JSON.stringify({ type: "response.create", ...body, generate: false }));
		for await (const event of mapCodexEvents(parseWebSocket(socket, options.signal, idleTimeoutMs, (value) => {
			if (!preserveContinuation) turnState?.capturePrewarm(value);
		}))) {
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
					};
				}
			}
		}
		assertSuccessfulCodexStatus(responseStatus);
		if (!preserveContinuation && entry && responseId) {
			entry.continuation = { lastRequestBody: body, lastResponseId: responseId, lastResponseItems: responseItems };
		}
		recordDiagnostics?.({ type: "prewarm-ready", transport: "websocket", socketReused: reused });
		return { socketReused: reused, ...(usage ? { usage } : {}) };
	} catch (error) {
		keepConnection = false;
		recordDiagnostics?.({
			type: "failure",
			lane: "prewarm",
			transport: "websocket",
			failure: codexDiagnosticsFailure(error),
		});
		throw error;
	} finally {
		release({ keep: keepConnection });
	}
}
