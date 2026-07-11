import { processResponsesStream } from "../openai-responses/shared.js";
import { CODEX_RESPONSE_STATUSES } from "./constants.js";
import { applyServiceTierPricing, resolveCodexServiceTier } from "./usage.js";
const WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE = "websocket_connection_limit_reached";
export class CodexApiError extends Error {
    code;
    payload;
    constructor(message, options) {
        super(message);
        this.name = "CodexApiError";
        this.code = options?.code;
        this.payload = options?.payload;
    }
}
export function isWebSocketConnectionLimitReachedError(error) {
    return error instanceof CodexApiError && error.code === WEBSOCKET_CONNECTION_LIMIT_REACHED_CODE;
}
function extractCodexEventError(event) {
    const nested = event["error"] && typeof event["error"] === "object" ? event["error"] : undefined;
    return {
        code: typeof event.code === "string" ? event.code : typeof nested?.["code"] === "string" ? nested["code"] : undefined,
        message: typeof event.message === "string" ? event.message : typeof nested?.["message"] === "string" ? nested["message"] : undefined,
    };
}
export async function* mapCodexEvents(events) {
    let sawTerminalResponse = false;
    for await (const event of events) {
        const type = typeof event.type === "string" ? event.type : undefined;
        if (!type)
            continue;
        if (type === "error") {
            const { code, message } = extractCodexEventError(event);
            throw new CodexApiError(`Codex error: ${message || code || JSON.stringify(event)}`, { code, payload: event });
        }
        if (type === "response.failed") {
            const code = typeof event.response?.error === "object" ? event.response.error.code : undefined;
            throw new CodexApiError(event.response?.error?.message || "Codex response failed", { code, payload: event });
        }
        if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
            sawTerminalResponse = true;
            const response = event.response;
            yield {
                ...event,
                type: "response.completed",
                response: response ? { ...response, status: normalizeCodexStatus(response.status) } : response,
            };
            return;
        }
        yield event;
    }
    if (!sawTerminalResponse) {
        throw new Error("Stream closed before response.completed");
    }
}
function normalizeCodexStatus(status) {
    if (typeof status !== "string")
        return undefined;
    return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}
function responseStreamOptions(options, model) {
    return {
        serviceTier: options?.serviceTier,
        ...(options?.onOutputItemDone ? { onOutputItemDone: options.onOutputItemDone } : {}),
        resolveServiceTier: resolveCodexServiceTier,
        applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model),
    };
}
export async function processMappedCodexResponsesStream(events, output, stream, model, options) {
    await processResponsesStream(events, output, stream, model, responseStreamOptions(options, model));
}
export async function processCodexResponsesStream(events, output, stream, model, options) {
    await processMappedCodexResponsesStream(mapCodexEvents(events), output, stream, model, options);
}
