import { isOpenAICodexContext, isResponsesContext } from "./prompt/codex-model.js";
import { applyCodexRequestParams } from "./activation/config.js";
import { isEffectiveOpenAICodexContext, shouldUseCodexAdapter } from "./activation/activation.js";
import { injectPendingNativeWindowIntoPiCompactionRequest, rewriteCodexCompactedProviderRequest } from "./compaction/compaction.js";
import { applyResponsesLiteRequest, supportsResponsesLiteModel } from "../providers/openai-codex/responses-lite.js";
export async function rewriteCodexProviderRequest(payload, ctx, state) {
    if (!shouldUseCodexAdapter(ctx, state.config) || (!isEffectiveOpenAICodexContext(ctx, state.config) && !isResponsesContext(ctx))) {
        return undefined;
    }
    const isEffectiveOpenAICodex = isEffectiveOpenAICodexContext(ctx, state.config);
    const configuredPayload = applyCodexRequestParams(payload, state.config, {
        serviceTier: isEffectiveOpenAICodex,
        verbosity: true,
    });
    const piCompactionPayload = await injectPendingNativeWindowIntoPiCompactionRequest(configuredPayload, ctx, state);
    const rewrittenPayload = piCompactionPayload ?? (await rewriteCodexCompactedProviderRequest(configuredPayload, ctx, state)) ?? configuredPayload;
    if (isOpenAICodexContext(ctx)
        && state.config.beta.responsesLite
        && isResponsesLiteCompatibleBody(rewrittenPayload)
        && supportsResponsesLiteModel(rewrittenPayload.model)) {
        return applyResponsesLiteRequest(rewrittenPayload);
    }
    return rewrittenPayload;
}
function isResponsesLiteCompatibleBody(value) {
    return typeof value === "object" && value !== null
        && typeof value.model === "string"
        && Array.isArray(value.input);
}
