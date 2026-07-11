import { isCodexLikeContext, isOpenAICodexContext, isResponsesContext } from "../prompt/codex-model.js";
import { APPLY_PATCH_TOOL_NAME, CORE_ADAPTER_TOOL_NAMES, DEFAULT_TOOL_NAMES, IMAGE_GENERATION_TOOL_NAME, PATH_MODE_TOOL_NAMES, STATUS_KEY, SHELL_ADAPTER_TOOL_NAMES, VIEW_IMAGE_TOOL_NAME, WEB_SEARCH_TOOL_NAME, buildExtraToolsOnlyStatusText, buildStatusText, } from "./tool-set.js";
import { supportsNativeImageGeneration } from "../../tools/imagegen/tool.js";
import { supportsNativeWebSearch } from "../../tools/web-run/tool.js";
import { supportsViewImageInputs } from "../../tools/view-image/tool.js";
const ADAPTER_TOOL_NAMES = [...CORE_ADAPTER_TOOL_NAMES, WEB_SEARCH_TOOL_NAME, IMAGE_GENERATION_TOOL_NAME, VIEW_IMAGE_TOOL_NAME];
export function syncAdapter(pi, ctx, state) {
    if (shouldUseExtraToolsOnly(ctx, state.config)) {
        enableExtraToolsOnly(pi, ctx, state);
        return;
    }
    if (shouldUseCodexAdapter(ctx, state.config)) {
        enableAdapter(pi, ctx, state);
    }
    else {
        disableAdapter(pi, ctx, state);
    }
}
export function shouldUseCodexAdapter(ctx, config) {
    if (shouldUseExtraToolsOnly(ctx, config))
        return false;
    return usesFullAdapterOnAllProviders(config) || isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx);
}
export function shouldUseNativeResponsesCompaction(ctx, config) {
    if (!config.compaction.responsesCompaction || shouldUseExtraToolsOnly(ctx, config))
        return false;
    return isOpenAICodexContext(ctx) || isConfiguredAdapterProvider(ctx, config);
}
export function isConfiguredAdapterProvider(ctx, config) {
    const provider = ctx.model?.provider?.trim().toLowerCase();
    return Boolean(provider && config.scope.additionalProviders.includes(provider));
}
export function shouldUseProxyNativeTools(ctx, config) {
    return config.mode === "normal" && isConfiguredAdapterProvider(ctx, config);
}
function shouldUseCodexBackedNativeTools(ctx, config) {
    return config.mode === "normal" && (usesAnyAdapterModeOnAllProviders(config) || isConfiguredAdapterProvider(ctx, config));
}
export function isEffectiveOpenAICodexContext(ctx, config) {
    return isOpenAICodexContext(ctx) || shouldUseProxyNativeTools(ctx, config);
}
export function shouldUseExtraToolsOnly(ctx, config) {
    if (config.mode !== "normal")
        return false;
    if (!hasExtraToolsOnlyConfig(config))
        return false;
    if (usesExtraToolsOnlyOnAllProviders(config))
        return true;
    return config.scope.allProviders === "off" && (isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx));
}
function hasExtraToolsOnlyConfig(config) {
    return config.tools.applyPatchOnly || config.tools.viewImageOnly || config.tools.webRunOnly || config.tools.imageGenerationOnly;
}
function usesFullAdapterOnAllProviders(config) {
    return config.scope.allProviders === "on";
}
function usesExtraToolsOnlyOnAllProviders(config) {
    return config.scope.allProviders === "extras";
}
function usesAnyAdapterModeOnAllProviders(config) {
    return config.scope.allProviders !== "off";
}
function enableExtraToolsOnly(pi, ctx, state) {
    const adapterOwnedTools = getExtraToolsOnlyToolNames(ctx, state.config);
    if (!state.enabled || !sameToolSet(state.adapterOwnedToolNames ?? [], adapterOwnedTools)) {
        const restoredBase = state.enabled
            ? restoreTools(state.previousToolNames && state.previousToolNames.length > 0 ? state.previousToolNames : DEFAULT_TOOL_NAMES, pi.getActiveTools(), state.adapterOwnedToolNames ?? ADAPTER_TOOL_NAMES)
            : stripAdapterTools(pi.getActiveTools(), ADAPTER_TOOL_NAMES);
        state.previousToolNames = restoredBase;
        state.enabled = true;
    }
    state.adapterOwnedToolNames = adapterOwnedTools;
    pi.setActiveTools(mergeToolNames(state.previousToolNames ?? DEFAULT_TOOL_NAMES, adapterOwnedTools));
    setExtraToolsOnlyStatus(ctx, state.config, adapterOwnedTools);
}
function enableAdapter(pi, ctx, state) {
    const currentAdapterOwnedTools = getAdapterOwnedToolNames(state.config);
    const adapterOwnedTools = state.enabled ? mergeToolNames(state.adapterOwnedToolNames ?? currentAdapterOwnedTools, currentAdapterOwnedTools) : currentAdapterOwnedTools;
    const toolNames = mergeAdapterTools(pi.getActiveTools(), getAdapterToolNames(ctx, state.config), adapterOwnedTools);
    if (!state.enabled) {
        // Preserve the previous active set once so switching away from Codex-like
        // models restores the user's existing Pi tool configuration. Strip adapter
        // tools in case a fresh session starts from persisted/mixed active tools.
        state.previousToolNames = stripAdapterTools(pi.getActiveTools(), adapterOwnedTools);
        state.enabled = true;
    }
    state.adapterOwnedToolNames = currentAdapterOwnedTools;
    pi.setActiveTools(toolNames);
    setStatus(ctx, true, state.config);
}
function disableAdapter(pi, ctx, state) {
    const previousToolNames = state.previousToolNames && state.previousToolNames.length > 0 ? state.previousToolNames : DEFAULT_TOOL_NAMES;
    const adapterOwnedTools = state.adapterOwnedToolNames ?? getAdapterOwnedToolNames(state.config);
    const restoredTools = restoreTools(previousToolNames, pi.getActiveTools(), adapterOwnedTools);
    if (state.enabled || hasAdapterTools(pi.getActiveTools(), adapterOwnedTools)) {
        pi.setActiveTools(restoredTools);
    }
    if (state.enabled) {
        state.enabled = false;
        delete state.adapterOwnedToolNames;
    }
    setStatus(ctx, false, state.config);
}
function setStatus(ctx, enabled, config) {
    if (!ctx.hasUI)
        return;
    if (!config.ui.statusLine) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        return;
    }
    const statusConfig = getStatusConfig(ctx, config);
    ctx.ui.setStatus(STATUS_KEY, enabled ? buildStatusText(statusConfig, ctx.ui.theme) : undefined);
}
function getStatusConfig(ctx, config) {
    const showOpenAICodexFlags = isEffectiveOpenAICodexContext(ctx, config);
    const showResponsesVerbosity = isResponsesContext(ctx);
    const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
    return {
        mode: config.mode,
        useOnAllModels: usesFullAdapterOnAllProviders(config),
        additionalProvider: isConfiguredAdapterProvider(ctx, config),
        fast: showOpenAICodexFlags && config.openai.fast,
        webSearch: config.mode === "normal" && config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools),
        imageGeneration: config.mode === "normal" && config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools),
        compaction: { enabled: shouldUseNativeResponsesCompaction(ctx, config), model: config.openai.compactionModel, reasoning: config.openai.compactionReasoning },
        ...(showResponsesVerbosity ? { verbosity: config.openai.verbosity } : {}),
    };
}
function getAdapterToolNames(ctx, config) {
    if (config.mode === "path")
        return [...PATH_MODE_TOOL_NAMES];
    const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
    const toolNames = [...CORE_ADAPTER_TOOL_NAMES];
    if (config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools))
        toolNames.push(WEB_SEARCH_TOOL_NAME);
    if (config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools))
        toolNames.push(IMAGE_GENERATION_TOOL_NAME);
    if (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback)
        toolNames.push(VIEW_IMAGE_TOOL_NAME);
    return toolNames;
}
function getExtraToolsOnlyToolNames(ctx, config) {
    const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
    const toolNames = [];
    if (config.tools.applyPatchOnly)
        toolNames.push(APPLY_PATCH_TOOL_NAME);
    if (config.tools.viewImageOnly && (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback))
        toolNames.push(VIEW_IMAGE_TOOL_NAME);
    if (config.tools.webRunOnly && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools))
        toolNames.push(WEB_SEARCH_TOOL_NAME);
    if (config.tools.imageGenerationOnly && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools))
        toolNames.push(IMAGE_GENERATION_TOOL_NAME);
    return toolNames;
}
function getAdapterOwnedToolNames(config) {
    if (config.mode === "path")
        return [...ADAPTER_TOOL_NAMES];
    return [
        ...SHELL_ADAPTER_TOOL_NAMES,
        APPLY_PATCH_TOOL_NAME,
        VIEW_IMAGE_TOOL_NAME,
        ...(config.tools.webRun ? [WEB_SEARCH_TOOL_NAME] : []),
        ...(config.tools.imageGeneration ? [IMAGE_GENERATION_TOOL_NAME] : []),
    ];
}
function setExtraToolsOnlyStatus(ctx, config, toolNames) {
    if (!ctx.hasUI)
        return;
    ctx.ui.setStatus(STATUS_KEY, config.ui.statusLine ? buildExtraToolsOnlyStatusText(toolNames, ctx.ui.theme) : undefined);
}
function mergeToolNames(...toolNameGroups) {
    return [...new Set(toolNameGroups.flat())];
}
export function mergeAdapterTools(activeTools, adapterTools, adapterOwnedTools = adapterTools) {
    const ownedTools = new Set([...CORE_ADAPTER_TOOL_NAMES, ...adapterTools, ...adapterOwnedTools]);
    const preservedTools = activeTools.filter((toolName) => !DEFAULT_TOOL_NAMES.includes(toolName) && !ownedTools.has(toolName));
    return [...adapterTools, ...preservedTools];
}
export function restoreTools(previousTools, activeTools, adapterOwnedTools = ADAPTER_TOOL_NAMES) {
    const restored = stripAdapterTools(previousTools, adapterOwnedTools);
    for (const toolName of activeTools) {
        if (!adapterOwnedTools.includes(toolName) && !restored.includes(toolName)) {
            restored.push(toolName);
        }
    }
    return restored;
}
export function stripAdapterTools(toolNames, adapterOwnedTools = ADAPTER_TOOL_NAMES) {
    return toolNames.filter((toolName) => !adapterOwnedTools.includes(toolName));
}
function hasAdapterTools(activeTools, adapterOwnedTools) {
    return activeTools.some((toolName) => adapterOwnedTools.includes(toolName));
}
function sameToolSet(left, right) {
    return left.length === right.length && left.every((toolName) => right.includes(toolName));
}
