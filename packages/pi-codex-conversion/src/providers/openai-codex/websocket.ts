import type { OpenAICodexStreamOptions } from "./types.ts";
import { normalizeTimeoutMs } from "./sse.ts";

export {
	acquireWebSocket,
	closeOpenAICodexWebSocketSessions,
	isWebSocketSseFallbackActive,
	recordWebSocketSseFallback,
	resetOpenAICodexWebSocketSessions,
} from "./websocket-session-cache.ts";
export { parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket-parser.ts";

export function validateWebSocketTimeoutOptions(options: OpenAICodexStreamOptions | undefined): void {
	normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
}
