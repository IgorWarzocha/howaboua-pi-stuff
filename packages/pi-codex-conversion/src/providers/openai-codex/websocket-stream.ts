import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import { normalizeTimeoutMs } from "./sse.ts";
import { buildCachedWebSocketRequestBody } from "./websocket-continuation.ts";
import { acquireWebSocket, parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket.ts";
import { assertSuccessfulCodexOutput, assertSuccessfulCodexStatus, mapCodexEvents, processMappedCodexResponsesStream } from "./stream-events.ts";
import type { CachedWebSocketRequestBodyResult, CodexDiagnosticsLane, CodexDiagnosticsSink, OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import type { CodexTurnState } from "./turn-state.ts";
import { DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS } from "./constants.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";

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
				socketReused: reused,
				continuation: cachedRequest.decision,
				previousResponseId: Boolean(requestBody.previous_response_id),
			});
		}
		socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
		await processMappedCodexResponsesStream(
			startWebSocketOutputOnFirstEvent(
				mapCodexEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs, (value) => turnState?.capture(value))),
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
): Promise<void> {
	const recordDiagnostics = noThrowCodexDiagnosticsSink(diagnostics);
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
	const { socket, entry, release, reused } = await acquireWebSocket(url, headers, options.sessionId, accountId, options.signal, websocketConnectTimeoutMs, options.env);
	let keepConnection = true;
	const responseItems: unknown[] = [];
	let responseId: string | undefined;
	let responseStatus: string | undefined;
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
		for await (const event of mapCodexEvents(parseWebSocket(socket, options.signal, idleTimeoutMs, (value) => turnState?.capturePrewarm(value)))) {
			if (event.type === "response.created" && event.response?.id) responseId = event.response.id;
			if (event.type === "response.output_item.done" && event.item) responseItems.push(event.item);
			if (event.type === "response.completed") {
				if (event.response?.id) responseId = event.response.id;
				responseStatus = event.response?.status;
			}
		}
		assertSuccessfulCodexStatus(responseStatus);
		if (entry && responseId) {
			entry.continuation = { lastRequestBody: body, lastResponseId: responseId, lastResponseItems: responseItems };
		}
		recordDiagnostics?.({ type: "prewarm-ready", transport: "websocket", socketReused: reused });
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
