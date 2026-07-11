import { DEFAULT_CODEX_BASE_URL, JWT_CLAIM_PATH, OPENAI_BETA_RESPONSES_WEBSOCKETS } from "./constants.js";
import { osInfo } from "./node-runtime.js";
import { RESPONSES_LITE_HEADER } from "./responses-lite.js";
export function extractAccountId(token) {
    try {
        const parts = token.split(".");
        if (parts.length !== 3)
            throw new Error("Invalid token");
        const payload = JSON.parse(Buffer.from(parts[1] ?? "", "base64").toString("utf8"));
        const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
        if (!accountId)
            throw new Error("No account ID in token");
        return accountId;
    }
    catch {
        throw new Error("Failed to extract accountId from token");
    }
}
export function resolveCodexUrl(baseUrl) {
    const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
    const normalized = raw.replace(/\/+$/, "");
    if (normalized.endsWith("/codex/responses"))
        return normalized;
    if (normalized.endsWith("/codex"))
        return `${normalized}/responses`;
    return `${normalized}/codex/responses`;
}
export function resolveCodexWebSocketUrl(baseUrl) {
    const url = new URL(resolveCodexUrl(baseUrl));
    if (url.protocol === "https:")
        url.protocol = "wss:";
    if (url.protocol === "http:")
        url.protocol = "ws:";
    return url.toString();
}
export function headersToRecord(headers) {
    return Object.fromEntries(headers.entries());
}
export function createCodexRequestId() {
    if (typeof globalThis.crypto?.randomUUID === "function") {
        return globalThis.crypto.randomUUID();
    }
    return `codex_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
function buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token) {
    const headers = new Headers(modelHeaders);
    for (const [key, value] of Object.entries(additionalHeaders ?? {})) {
        if (value === null) {
            headers.delete(key);
        }
        else {
            headers.set(key, value);
        }
    }
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("chatgpt-account-id", accountId);
    headers.set("originator", "pi");
    const os = osInfo.current;
    headers.set("User-Agent", os ? `pi (${os.platform()} ${os.release()}; ${os.arch()})` : "pi (browser)");
    return headers;
}
export function buildSSEHeaders(modelHeaders, additionalHeaders, accountId, token, sessionId, responsesLite = false) {
    const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
    headers.set("OpenAI-Beta", "responses=experimental");
    headers.set("accept", "text/event-stream");
    headers.set("content-type", "application/json");
    if (responsesLite)
        headers.set(RESPONSES_LITE_HEADER, "true");
    if (sessionId) {
        headers.set("session-id", sessionId);
        headers.set("thread-id", sessionId);
        headers.set("x-client-request-id", sessionId);
    }
    return headers;
}
export function buildWebSocketHeaders(modelHeaders, additionalHeaders, accountId, token, requestId) {
    const headers = buildBaseCodexHeaders(modelHeaders, additionalHeaders, accountId, token);
    headers.delete("accept");
    headers.delete("content-type");
    headers.delete("OpenAI-Beta");
    headers.delete("openai-beta");
    headers.set("OpenAI-Beta", OPENAI_BETA_RESPONSES_WEBSOCKETS);
    headers.set("x-client-request-id", requestId);
    headers.set("session-id", requestId);
    headers.set("thread-id", requestId);
    return headers;
}
