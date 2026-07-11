import { RESPONSES_LITE_HEADER } from "../../providers/openai-codex/responses-lite.js";
import { CODEX_TURN_STATE_HEADER } from "../../providers/openai-codex/turn-state.js";
const JSON_CONTENT_TYPE = "application/json";
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function isAbortError(error) {
    return ((error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error && (error.name === "AbortError" || error.name === "ABORT_ERR")));
}
function normalizeResponseTimestamp(value) {
    if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(milliseconds).toISOString();
    }
    if (typeof value !== "string") {
        return undefined;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return undefined;
    }
    const parsed = Date.parse(trimmed);
    return Number.isNaN(parsed) ? trimmed : new Date(parsed).toISOString();
}
function isCompactOutputItem(value) {
    return isRecord(value);
}
function isCompactResponseEnvelope(value) {
    return isRecord(value) && Array.isArray(value["output"]) && value["output"].every(isCompactOutputItem);
}
function decodeJwtPayload(token) {
    const parts = token.split(".");
    if (parts.length !== 3) {
        return undefined;
    }
    try {
        const payloadText = Buffer.from(parts[1], "base64url").toString("utf8");
        const payload = JSON.parse(payloadText);
        return isRecord(payload) ? payload : undefined;
    }
    catch {
        return undefined;
    }
}
function extractCodexAccountId(token) {
    const payload = decodeJwtPayload(token);
    const authClaims = payload?.["https://api.openai.com/auth"];
    if (!isRecord(authClaims)) {
        return undefined;
    }
    const accountId = authClaims["chatgpt_account_id"];
    return typeof accountId === "string" && accountId.trim().length > 0 ? accountId.trim() : undefined;
}
function buildCodexUserAgent() {
    const platform = typeof process !== "undefined" ? process.platform : "browser";
    const arch = typeof process !== "undefined" ? process.arch : "unknown";
    return `pi (${platform}; ${arch})`;
}
function extractBearerToken(headers) {
    const authorization = headers.get("authorization")?.trim();
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    return match?.[1]?.trim() || undefined;
}
function toHeaders(runtime, responsesLite = false) {
    const headers = new Headers(runtime.currentModel.headers ?? {});
    for (const [key, value] of Object.entries(runtime.headers ?? {})) {
        headers.set(key, value);
    }
    headers.set("accept", JSON_CONTENT_TYPE);
    headers.set("content-type", JSON_CONTENT_TYPE);
    if (runtime.apiKey) {
        headers.set("authorization", `Bearer ${runtime.apiKey}`);
    }
    if (runtime.provider === "openai-codex") {
        const accountId = extractCodexAccountId(runtime.apiKey ?? extractBearerToken(headers) ?? "");
        if (accountId) {
            headers.set("chatgpt-account-id", accountId);
        }
        headers.set("originator", "pi");
        headers.set("user-agent", buildCodexUserAgent());
        headers.set("openai-beta", "responses=experimental");
        if (responsesLite)
            headers.set(RESPONSES_LITE_HEADER, "true");
    }
    return Object.fromEntries(headers.entries());
}
export async function executeNativeCompaction(options) {
    const { runtime, request, signal } = options;
    const headers = toHeaders(runtime, options.responsesLite);
    const currentTurnState = options.turnState?.current();
    if (currentTurnState && runtime.provider === "openai-codex")
        headers[CODEX_TURN_STATE_HEADER] = currentTurnState;
    if (options.sessionId && runtime.provider === "openai-codex") {
        headers["session-id"] = options.sessionId;
        headers["thread-id"] = options.sessionId;
    }
    if (signal?.aborted) {
        const aborted = {
            ok: false,
            reason: "aborted",
        };
        return aborted;
    }
    try {
        const response = await fetch(runtime.compactUrl, {
            method: "POST",
            headers,
            body: JSON.stringify(request),
            ...(signal ? { signal } : {}),
        });
        if (response.ok && runtime.provider === "openai-codex") {
            options.turnState?.capture(response.headers.get(CODEX_TURN_STATE_HEADER));
        }
        const responseText = await response.text();
        if (!response.ok) {
            let responseJson;
            if (responseText.trim().length > 0) {
                try {
                    responseJson = JSON.parse(responseText);
                }
                catch {
                    responseJson = undefined;
                }
            }
            const failure = {
                ok: false,
                reason: "non-2xx",
                status: response.status,
                responseText: responseText || undefined,
                responseJson,
            };
            return failure;
        }
        if (!responseText.trim()) {
            const failure = {
                ok: false,
                reason: "empty-body",
                status: response.status,
            };
            return failure;
        }
        let parsed;
        try {
            parsed = JSON.parse(responseText);
        }
        catch (error) {
            const failure = {
                ok: false,
                reason: "invalid-json",
                status: response.status,
                errorMessage: error instanceof Error ? error.message : String(error),
                responseText,
            };
            return failure;
        }
        if (!isCompactResponseEnvelope(parsed)) {
            const failure = {
                ok: false,
                reason: "malformed-response",
                status: response.status,
                responseJson: parsed,
            };
            return failure;
        }
        if (parsed.output.length === 0) {
            const failure = {
                ok: false,
                reason: "empty-output",
                status: response.status,
                responseJson: parsed,
            };
            return failure;
        }
        const success = {
            ok: true,
            status: response.status,
            compactedWindow: [...parsed.output],
            compactResponseId: typeof parsed.id === "string" && parsed.id.trim() ? parsed.id.trim() : undefined,
            createdAt: normalizeResponseTimestamp(parsed.created_at),
            response: parsed,
        };
        return success;
    }
    catch (error) {
        const failure = isAbortError(error)
            ? {
                ok: false,
                reason: "aborted",
            }
            : {
                ok: false,
                reason: "network-error",
                errorMessage: error instanceof Error ? error.message : String(error),
            };
        return failure;
    }
}
