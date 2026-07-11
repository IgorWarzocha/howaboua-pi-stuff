import { getEncoding } from "js-tiktoken";
export const COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE = "[truncated]";
const COMPACTION_TOKEN_ENCODING = getEncoding("o200k_base");
const COMPACTION_BUDGET_RATIO = 0.8;
function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}
function estimateTokenCount(value) {
    const serialized = typeof value === "string" ? value : JSON.stringify(value) ?? "";
    try {
        return COMPACTION_TOKEN_ENCODING.encode(serialized).length;
    }
    catch {
        return Math.ceil(serialized.length / 2);
    }
}
function isRewritableToolOutputItem(item) {
    if (!isRecord(item))
        return false;
    const record = item;
    return record["type"] === "function_call_output" && record["output"] !== COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE;
}
function rewriteToolOutputItem(item) {
    return {
        ...item,
        output: COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE,
    };
}
function compactRequestBudget(options) {
    const contextWindow = options.contextWindow;
    if (typeof contextWindow !== "number" || !Number.isFinite(contextWindow) || contextWindow <= 0)
        return undefined;
    return Math.floor(contextWindow * COMPACTION_BUDGET_RATIO);
}
export function shrinkNativeCompactionRequestForEndpoint(request, options = {}) {
    const budgetTokens = compactRequestBudget(options);
    const estimatedTokensBefore = estimateTokenCount(request);
    if (budgetTokens === undefined || estimatedTokensBefore <= budgetTokens) {
        return {
            request,
            rewrittenOutputs: 0,
            estimatedTokensBefore,
            estimatedTokensAfter: estimatedTokensBefore,
            budgetTokens,
        };
    }
    let rewrittenOutputs = 0;
    let estimatedTokensAfter = estimatedTokensBefore;
    let input;
    for (let index = 0; index < request.input.length && estimatedTokensAfter > budgetTokens; index++) {
        const item = (input ?? request.input)[index];
        if (!isRewritableToolOutputItem(item))
            continue;
        input ??= [...request.input];
        const rewrittenItem = rewriteToolOutputItem(item);
        input[index] = rewrittenItem;
        rewrittenOutputs++;
        estimatedTokensAfter += estimateTokenCount(rewrittenItem) - estimateTokenCount(item);
    }
    return {
        request: input ? { ...request, input } : request,
        rewrittenOutputs,
        estimatedTokensBefore,
        estimatedTokensAfter,
        budgetTokens,
    };
}
