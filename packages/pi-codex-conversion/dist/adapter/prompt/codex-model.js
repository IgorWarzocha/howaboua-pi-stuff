export function isOpenAICodexModel(model) {
    if (!model)
        return false;
    return (model.provider ?? "").toLowerCase() === "openai-codex";
}
export function isResponsesModel(model) {
    if (!model)
        return false;
    return (model.api ?? "").toLowerCase().includes("responses");
}
// Keep model detection intentionally conservative. The adapter replaces the
// system prompt and tool surface, so false positives are worse than misses.
export function isCodexLikeModel(model) {
    if (!model)
        return false;
    const provider = (model.provider ?? "").toLowerCase();
    const api = (model.api ?? "").toLowerCase();
    const id = (model.id ?? "").toLowerCase();
    const isCopilotGpt = (provider.includes("copilot") || api.includes("copilot")) && id.includes("gpt");
    return provider.includes("codex") || api.includes("codex") || id.includes("codex") || (provider.includes("openai") && id.includes("gpt")) || isCopilotGpt;
}
export function isCodexLikeContext(ctx) {
    return isCodexLikeModel(ctx.model);
}
export function isOpenAICodexContext(ctx) {
    return isOpenAICodexModel(ctx.model);
}
export function isResponsesContext(ctx) {
    return isResponsesModel(ctx.model);
}
