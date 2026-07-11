import { normalizeTimeoutMs } from "./sse.js";
export { closeOpenAICodexWebSocketSessions, acquireWebSocket } from "./websocket-session-cache.js";
export { countWebSocketEvents, isRetryableEarlyWebSocketError, parseWebSocket, startWebSocketOutputOnFirstEvent } from "./websocket-parser.js";
export function validateWebSocketTimeoutOptions(options) {
    normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
    normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
}
