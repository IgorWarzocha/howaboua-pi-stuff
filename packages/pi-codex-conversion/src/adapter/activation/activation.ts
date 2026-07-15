import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isCodexLikeContext, isOpenAICodexContext, isOpenAIResponsesContext, isResponsesContext } from "../prompt/codex-model.ts";
import { supportsResponsesLiteModel } from "../../providers/openai-codex/responses-lite.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { AdapterState } from "./state.ts";
import {
	APPLY_PATCH_TOOL_NAME,
	CORE_ADAPTER_TOOL_NAMES,
	CODE_MODE_TOOL_NAMES,
	DEFAULT_TOOL_NAMES,
	IMAGE_GENERATION_TOOL_NAME,
	PATH_MODE_TOOL_NAMES,
	STATUS_KEY,
	SHELL_ADAPTER_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
	WEB_SEARCH_TOOL_NAME,
	buildExtraToolsOnlyStatusText,
	buildStatusText,
} from "./tool-set.ts";
import { supportsNativeImageGeneration } from "../../tools/imagegen/tool.ts";
import { supportsNativeWebSearch } from "../../tools/web-run/tool.ts";
import { supportsViewImageInputs } from "../../tools/view-image/tool.ts";

const ADAPTER_TOOL_NAMES = [...CORE_ADAPTER_TOOL_NAMES, ...CODE_MODE_TOOL_NAMES, WEB_SEARCH_TOOL_NAME, IMAGE_GENERATION_TOOL_NAME, VIEW_IMAGE_TOOL_NAME];

export function syncAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
	if (shouldUseExtraToolsOnly(ctx, state.config)) {
		enableExtraToolsOnly(pi, ctx, state);
		return;
	}
	if (shouldUseCodexAdapter(ctx, state.config)) {
		enableAdapter(pi, ctx, state);
	} else {
		disableAdapter(pi, ctx, state);
	}
}

export function shouldUseCodexAdapter(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (shouldUseExtraToolsOnly(ctx, config)) return false;
	return usesFullAdapterOnAllProviders(config) || isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx);
}

export function shouldUseNativeResponsesCompaction(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (!config.compaction.responsesCompaction || shouldUseExtraToolsOnly(ctx, config)) return false;
	return isOpenAICodexContext(ctx) || isConfiguredAdapterProvider(ctx, config);
}

export function shouldUseGpt56CodeMode(ctx: Pick<ExtensionContext, "model">, config: CodexConversionConfig): boolean {
	if (!config.beta.codeMode) return false;
	if (isOpenAICodexContext(ctx)) return supportsResponsesLiteModel(ctx.model?.id);
	return isConfiguredAdapterProvider(ctx, config)
		&& isOpenAIResponsesContext(ctx)
		&& supportsProxiedGpt56CodeModeModel(ctx.model);
}

export function supportsProxiedGpt56CodeModeModel(model: string | { id: string } | undefined): boolean {
	const modelId = typeof model === "string" ? model : model?.id;
	if (!modelId) return false;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	return /^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id.toLowerCase());
}

export function shouldUseResponsesLiteForCodeMode(ctx: Pick<ExtensionContext, "model">, config: CodexConversionConfig): boolean {
	if (!shouldUseGpt56CodeMode(ctx, config)) return false;
	return isOpenAICodexContext(ctx) || config.beta.responsesLite;
}

export function isConfiguredAdapterProvider(ctx: Pick<ExtensionContext, "model">, config: CodexConversionConfig): boolean {
	const provider = ctx.model?.provider?.trim().toLowerCase();
	return Boolean(provider && config.scope.additionalProviders.includes(provider));
}

export function shouldUseProxyNativeTools(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return config.mode === "normal" && isConfiguredAdapterProvider(ctx, config);
}

function shouldUseCodexBackedNativeTools(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return config.mode === "normal" && (usesAnyAdapterModeOnAllProviders(config) || isConfiguredAdapterProvider(ctx, config));
}

export function isEffectiveOpenAICodexContext(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return isOpenAICodexContext(ctx) || shouldUseProxyNativeTools(ctx, config);
}

export function shouldUseExtraToolsOnly(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (config.mode !== "normal") return false;
	if (!hasExtraToolsOnlyConfig(config)) return false;
	if (usesExtraToolsOnlyOnAllProviders(config)) return true;
	return config.scope.allProviders === "off" && (isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx));
}

function hasExtraToolsOnlyConfig(config: CodexConversionConfig): boolean {
	return config.tools.applyPatchOnly || config.tools.viewImageOnly || config.tools.webRunOnly || config.tools.imageGenerationOnly;
}

function usesFullAdapterOnAllProviders(config: CodexConversionConfig): boolean {
	return config.scope.allProviders === "on";
}

function usesExtraToolsOnlyOnAllProviders(config: CodexConversionConfig): boolean {
	return config.scope.allProviders === "extras";
}

function usesAnyAdapterModeOnAllProviders(config: CodexConversionConfig): boolean {
	return config.scope.allProviders !== "off";
}

function enableExtraToolsOnly(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
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

function enableAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
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

function disableAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
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

function setStatus(ctx: ExtensionContext, enabled: boolean, config: CodexConversionConfig): void {
	if (!ctx.hasUI) return;
	if (!config.ui.statusLine) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const statusConfig = getStatusConfig(ctx, config);
	ctx.ui.setStatus(STATUS_KEY, enabled ? buildStatusText(statusConfig, ctx.ui.theme) : undefined);
}

function getStatusConfig(ctx: ExtensionContext, config: CodexConversionConfig): Parameters<typeof buildStatusText>[0] {
	const showOpenAICodexFlags = isEffectiveOpenAICodexContext(ctx, config);
	const showResponsesVerbosity = isResponsesContext(ctx);
	const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
	return {
		mode: shouldUseGpt56CodeMode(ctx, config) ? "code" : config.mode,
		useOnAllModels: usesFullAdapterOnAllProviders(config),
		additionalProvider: isConfiguredAdapterProvider(ctx, config),
		fast: showOpenAICodexFlags && config.openai.fast,
		webSearch: config.mode === "normal" && config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools),
		imageGeneration: config.mode === "normal" && config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools),
		compaction: { enabled: shouldUseNativeResponsesCompaction(ctx, config), model: config.openai.compactionModel, reasoning: config.openai.compactionReasoning },
		...(showResponsesVerbosity ? { verbosity: config.openai.verbosity } : {}),
	};
}

function getAdapterToolNames(ctx: ExtensionContext, config: CodexConversionConfig): string[] {
	if (shouldUseGpt56CodeMode(ctx, config)) return [...CODE_MODE_TOOL_NAMES];
	if (config.mode === "path") return [...PATH_MODE_TOOL_NAMES];
	const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
	const toolNames = [...CORE_ADAPTER_TOOL_NAMES];
	if (config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools)) toolNames.push(WEB_SEARCH_TOOL_NAME);
	if (config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools)) toolNames.push(IMAGE_GENERATION_TOOL_NAME);
	if (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback) toolNames.push(VIEW_IMAGE_TOOL_NAME);
	return toolNames;
}

function getExtraToolsOnlyToolNames(ctx: ExtensionContext, config: CodexConversionConfig): string[] {
	const useCodexBackedNativeTools = shouldUseCodexBackedNativeTools(ctx, config);
	const toolNames: string[] = [];
	if (config.tools.applyPatchOnly) toolNames.push(APPLY_PATCH_TOOL_NAME);
	if (config.tools.viewImageOnly && (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback)) toolNames.push(VIEW_IMAGE_TOOL_NAME);
	if (config.tools.webRunOnly && (supportsNativeWebSearch(ctx.model) || useCodexBackedNativeTools)) toolNames.push(WEB_SEARCH_TOOL_NAME);
	if (config.tools.imageGenerationOnly && (supportsNativeImageGeneration(ctx.model) || useCodexBackedNativeTools)) toolNames.push(IMAGE_GENERATION_TOOL_NAME);
	return toolNames;
}

function getAdapterOwnedToolNames(config: CodexConversionConfig): string[] {
	if (config.mode === "path") return [...ADAPTER_TOOL_NAMES];
	return [
		...SHELL_ADAPTER_TOOL_NAMES,
		...CODE_MODE_TOOL_NAMES,
		APPLY_PATCH_TOOL_NAME,
		VIEW_IMAGE_TOOL_NAME,
		...(config.tools.webRun ? [WEB_SEARCH_TOOL_NAME] : []),
		...(config.tools.imageGeneration ? [IMAGE_GENERATION_TOOL_NAME] : []),
	];
}

function setExtraToolsOnlyStatus(ctx: ExtensionContext, config: CodexConversionConfig, toolNames: string[]): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, config.ui.statusLine ? buildExtraToolsOnlyStatusText(toolNames, ctx.ui.theme) : undefined);
}

function mergeToolNames(...toolNameGroups: string[][]): string[] {
	return [...new Set(toolNameGroups.flat())];
}

export function mergeAdapterTools(activeTools: string[], adapterTools: string[], adapterOwnedTools: string[] = adapterTools): string[] {
	const ownedTools = new Set([...CORE_ADAPTER_TOOL_NAMES, ...adapterTools, ...adapterOwnedTools]);
	const preservedTools = activeTools.filter((toolName) => !DEFAULT_TOOL_NAMES.includes(toolName) && !ownedTools.has(toolName));
	return [...adapterTools, ...preservedTools];
}

export function restoreTools(previousTools: string[], activeTools: string[], adapterOwnedTools: string[] = ADAPTER_TOOL_NAMES): string[] {
	const restored = stripAdapterTools(previousTools, adapterOwnedTools);
	for (const toolName of activeTools) {
		if (!adapterOwnedTools.includes(toolName) && !restored.includes(toolName)) {
			restored.push(toolName);
		}
	}
	return restored;
}

export function stripAdapterTools(toolNames: string[], adapterOwnedTools: string[] = ADAPTER_TOOL_NAMES): string[] {
	return toolNames.filter((toolName) => !adapterOwnedTools.includes(toolName));
}

function hasAdapterTools(activeTools: string[], adapterOwnedTools: string[]): boolean {
	return activeTools.some((toolName) => adapterOwnedTools.includes(toolName));
}

function sameToolSet(left: string[], right: string[]): boolean {
	return left.length === right.length && left.every((toolName) => right.includes(toolName));
}
