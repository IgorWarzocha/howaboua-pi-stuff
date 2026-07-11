import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convertToLlm, getAgentDir } from "@earendil-works/pi-coding-agent";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages } from "../../providers/openai-responses/shared.js";
/**
 * Decision for native compaction: reuse the provider's Responses serializer.
 *
 * Replay parity must match the actual OpenAI Codex provider payload, including
 * tool-call id normalization and cross-model/provider history handling.
 */
export const COMPACTION_SERIALIZER_STRATEGY = "provider-responses-serializer";
function sanitizeSurrogates(text) {
    return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
let cachedBlockImagesSetting;
function readBlockImagesSetting() {
    if (cachedBlockImagesSetting !== undefined)
        return cachedBlockImagesSetting;
    try {
        const parsed = JSON.parse(readFileSync(join(getAgentDir(), "settings.json"), "utf-8"));
        cachedBlockImagesSetting = isRecord(parsed) && isRecord(parsed["images"]) && parsed["images"]["blockImages"] === true;
    }
    catch {
        cachedBlockImagesSetting = false;
    }
    return cachedBlockImagesSetting;
}
function replaceImagesWithDisabledPlaceholder(message) {
    if (!Array.isArray(message.content) || !message.content.some((item) => item.type === "image"))
        return message;
    const content = message.content
        .map((item) => item.type === "image" ? { type: "text", text: "Image reading is disabled." } : item)
        .filter((item, index, items) => {
        const previous = (items[index - 1]);
        return !(item.type === "text" && item.text === "Image reading is disabled." && previous?.type === "text" && previous.text === "Image reading is disabled.");
    });
    return { ...message, content };
}
function applyBlockImages(messages, blockImages) {
    if (!blockImages)
        return messages;
    return messages.map((message) => {
        if (message.role === "user" || message.role === "toolResult")
            return replaceImagesWithDisabledPlaceholder(message);
        return message;
    });
}
export function collectCompactionWindowMessages(preparation) {
    const previousSummary = preparation.previousSummary?.trim();
    const previousSummaryMessages = previousSummary
        ? [
            {
                role: "user",
                content: `Previous compaction summary:\n${previousSummary}`,
                timestamp: Date.now(),
            },
        ]
        : [];
    return [...previousSummaryMessages, ...preparation.messagesToSummarize, ...preparation.turnPrefixMessages];
}
export function serializeCompactionPreparationToRequest(args) {
    return serializeMessagesToCompactRequest({
        model: args.model,
        messages: collectCompactionWindowMessages(args.preparation),
        instructions: args.instructions,
        requestOptions: args.requestOptions,
    });
}
export function serializeMessagesToCompactRequest(args) {
    return {
        model: args.model.id,
        input: serializeMessagesToResponsesInput(args.model, args.messages),
        instructions: sanitizeSurrogates(args.instructions),
        ...args.requestOptions,
    };
}
export function serializeMessagesToResponsesInput(model, messages, options = {}) {
    const llmMessages = applyBlockImages(convertToLlm(messages), options.blockImages ?? readBlockImagesSetting());
    return convertResponsesMessages(model, {
        messages: llmMessages,
        ...(options.includeInstructionsInInput && options.instructions ? { systemPrompt: options.instructions } : {}),
    }, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: options.includeInstructionsInInput ?? false });
}
export function createResponsesInputParitySignature(input) {
    return input.map(describeResponsesInputItem);
}
export function compareResponsesInputParity(actual, expected) {
    const actualSignature = createResponsesInputParitySignature(actual);
    const expectedSignature = createResponsesInputParitySignature(expected);
    const maxLength = Math.max(actualSignature.length, expectedSignature.length);
    const mismatches = [];
    for (let index = 0; index < maxLength; index++) {
        const actualValue = actualSignature[index];
        const expectedValue = expectedSignature[index];
        if (actualValue !== expectedValue) {
            mismatches.push(`index ${index}: expected ${expectedValue ?? "<missing>"}, got ${actualValue ?? "<missing>"}`);
        }
    }
    return {
        ok: mismatches.length === 0,
        actual: actualSignature,
        expected: expectedSignature,
        mismatches,
    };
}
export function compareCompactRequestToPayload(request, payload) {
    const parity = compareResponsesInputParity(request.input, payload.input);
    const mismatches = [...parity.mismatches];
    if (payload.model !== request.model) {
        mismatches.unshift(`model: expected ${payload.model}, got ${request.model}`);
    }
    if ((payload.instructions ?? "") !== request.instructions) {
        mismatches.unshift("instructions: expected serialized instructions to match payload instructions");
    }
    return {
        ok: mismatches.length === 0,
        actual: parity.actual,
        expected: parity.expected,
        mismatches,
    };
}
function describeResponsesInputItem(item) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
        return typeof item;
    }
    const record = item;
    const type = typeof record["type"] === "string" ? record["type"] : undefined;
    if (type === "message") {
        const phase = record["phase"] === "commentary" || record["phase"] === "final_answer"
            ? `:${record["phase"]}`
            : "";
        return `message:${typeof record["role"] === "string" ? record["role"] : "unknown"}${phase}`;
    }
    if (type === "function_call") {
        return `function_call:${typeof record["name"] === "string" ? record["name"] : "unknown"}`;
    }
    if (type === "function_call_output") {
        return "function_call_output";
    }
    if (type === "reasoning") {
        return "reasoning";
    }
    if (typeof record["role"] === "string") {
        const content = Array.isArray(record["content"]) ? `[${record["content"].length}]` : "";
        return `input:${record["role"]}${content}`;
    }
    return type ? `item:${type}` : "object";
}
