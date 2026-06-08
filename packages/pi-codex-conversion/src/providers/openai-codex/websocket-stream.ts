import type { Api, AssistantMessage, AssistantMessageEventStream, Model, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages } from "../openai-responses/shared.ts";
import { normalizeTimeoutMs } from "./sse.ts";
import { buildCachedWebSocketRequestBody } from "./websocket-continuation.ts";
import { acquireWebSocket, countWebSocketEvents, isRetryableEarlyWebSocketError, parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket.ts";
import { processCodexResponsesStream } from "./stream-events.ts";
import type { CachedWebSocketRequestBodyResult, ResponsesBody } from "./types.ts";

export async function processWebSocketStream<TApi extends Api>(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	onStart: () => void,
	options: SimpleStreamOptions | undefined,
): Promise<void> {
	let streamStarted = false;
	const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");

	for (let attempt = 0; attempt < 2; attempt++) {
		const { socket, entry, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal, websocketConnectTimeoutMs);
		let keepConnection = true;
		let released = false;
		let eventCount = 0;
		const transport = (options as { transport?: string | undefined } | undefined)?.transport ?? "auto";
		const useCachedContext = transport === "websocket-cached" || transport === "auto";
		// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
		// WebSocket continuation still works via connection-scoped previous_response_id state.
		const fullBody = body;
		const cachedRequest = useCachedContext && entry
			? buildCachedWebSocketRequestBody(entry.continuation, fullBody)
			: { body: fullBody, decision: useCachedContext ? "no_session_cache_entry" : "disabled" } satisfies CachedWebSocketRequestBodyResult;
		const requestBody = cachedRequest.body;

		const releaseOnce = (releaseOptions?: { keep?: boolean | undefined }) => {
			if (released) return;
			released = true;
			release(releaseOptions);
		};

		try {
			socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
			await processCodexResponsesStream(
				startWebSocketOutputOnFirstEvent(
					countWebSocketEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs), () => {
						eventCount++;
					}),
					output,
					stream,
					() => {
						streamStarted = true;
						onStart();
					},
				),
				output,
				stream,
				model,
				options,
			);
			if (options?.signal?.aborted) {
				keepConnection = false;
			} else if (useCachedContext && entry && output.responseId) {
				const responseItems = convertResponsesMessages(model, { messages: [output] }, CODEX_TOOL_CALL_PROVIDERS, {
					includeSystemPrompt: false,
				}).filter((item) => typeof item === "object" && item !== null && (item as { type?: unknown | undefined }).type !== "function_call_output");
				entry.continuation = {
					lastRequestBody: fullBody,
					lastResponseId: output.responseId,
					lastResponseItems: responseItems,
				};
			}
			releaseOnce({ keep: keepConnection });
			return;
		} catch (error) {
			if (entry) {
				entry.continuation = undefined;
			}
			keepConnection = false;
			releaseOnce({ keep: false });
			// If WebSocket fails before the first response event, nothing has been
			// emitted to the UI/history yet. Retry once on a fresh WebSocket; if that
			// also fails, the caller can fall back to SSE for `auto` transport.
			if (attempt === 0 && eventCount === 0 && !streamStarted && !options?.signal?.aborted && isRetryableEarlyWebSocketError(error)) {
				continue;
			}
			throw error;
		} finally {
			releaseOnce({ keep: keepConnection });
		}
	}
}
