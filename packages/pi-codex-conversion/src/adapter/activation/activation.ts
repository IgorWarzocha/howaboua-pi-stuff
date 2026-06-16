import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isCodexLikeContext, isOpenAICodexContext, isResponsesContext } from "../prompt/codex-model.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { AdapterState } from "./state.ts";
import {
	APPLY_PATCH_TOOL_NAME,
	CORE_ADAPTER_TOOL_NAMES,
	DEFAULT_TOOL_NAMES,
	IMAGE_GENERATION_TOOL_NAME,
	PATH_MODE_TOOL_NAMES,
	STATUS_KEY,
	SHELL_ADAPTER_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
	WEB_SEARCH_TOOL_NAME,
	buildApplyPatchOnlyStatusText,
	buildStatusText,
} from "./tool-set.ts";
import { supportsNativeImageGeneration } from "../../tools/imagegen/tool.ts";
import { supportsNativeWebSearch } from "../../tools/web-run/tool.ts";

const ADAPTER_TOOL_NAMES = [...CORE_ADAPTER_TOOL_NAMES, WEB_SEARCH_TOOL_NAME, IMAGE_GENERATION_TOOL_NAME, VIEW_IMAGE_TOOL_NAME];

export function syncAdapter(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
	if (shouldUseApplyPatchOnly(ctx, state.config)) {
		enableApplyPatchOnly(pi, ctx, state);
		return;
	}
	if (shouldUseCodexAdapter(ctx, state.config)) {
		enableAdapter(pi, ctx, state);
	} else {
		disableAdapter(pi, ctx, state);
	}
}

export function shouldUseCodexAdapter(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (shouldUseApplyPatchOnly(ctx, config)) return false;
	return config.scope.allProviders || isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx);
}

export function isConfiguredAdapterProvider(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	const provider = ctx.model?.provider?.trim().toLowerCase();
	return Boolean(provider && config.scope.additionalProviders.includes(provider));
}

export function shouldUseProxyNativeTools(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return config.mode === "normal" && isConfiguredAdapterProvider(ctx, config);
}

export function isEffectiveOpenAICodexContext(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return isOpenAICodexContext(ctx) || shouldUseProxyNativeTools(ctx, config);
}

export function shouldUseApplyPatchOnly(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (config.mode !== "normal") return false;
	return config.tools.applyPatchOnly && shouldUseCodexAdapterByScope(ctx, config);
}

function shouldUseCodexAdapterByScope(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return config.scope.allProviders || isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx);
}

function enableApplyPatchOnly(pi: ExtensionAPI, ctx: ExtensionContext, state: AdapterState): void {
	const adapterOwnedTools = [APPLY_PATCH_TOOL_NAME];
	if (!state.enabled || state.adapterOwnedToolNames?.some((toolName) => toolName !== APPLY_PATCH_TOOL_NAME)) {
		const restoredBase = state.enabled
			? restoreTools(state.previousToolNames && state.previousToolNames.length > 0 ? state.previousToolNames : DEFAULT_TOOL_NAMES, pi.getActiveTools(), state.adapterOwnedToolNames ?? ADAPTER_TOOL_NAMES)
			: stripAdapterTools(pi.getActiveTools(), ADAPTER_TOOL_NAMES);
		state.previousToolNames = restoredBase;
		state.enabled = true;
	}
	state.adapterOwnedToolNames = adapterOwnedTools;
	pi.setActiveTools(mergeToolNames(state.previousToolNames ?? DEFAULT_TOOL_NAMES, adapterOwnedTools));
	setApplyPatchOnlyStatus(ctx, state.config);
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
	const useProxyNativeTools = shouldUseProxyNativeTools(ctx, config);
	return {
		mode: config.mode,
		useOnAllModels: config.scope.allProviders,
		additionalProvider: isConfiguredAdapterProvider(ctx, config),
		fast: showOpenAICodexFlags && config.openai.fast,
		webSearch: config.mode === "normal" && showOpenAICodexFlags && config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useProxyNativeTools),
		imageGeneration: config.mode === "normal" && showOpenAICodexFlags && config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useProxyNativeTools),
		compaction: { enabled: Boolean(config.compaction.responsesCompaction), model: config.openai.compactionModel, reasoning: config.openai.compactionReasoning },
		...(showResponsesVerbosity ? { verbosity: config.openai.verbosity } : {}),
	};
}

function getAdapterToolNames(ctx: ExtensionContext, config: CodexConversionConfig): string[] {
	if (config.mode === "path") return [...PATH_MODE_TOOL_NAMES];
	const useProxyNativeTools = shouldUseProxyNativeTools(ctx, config);
	const toolNames = [...CORE_ADAPTER_TOOL_NAMES];
	if (config.tools.webRun && (supportsNativeWebSearch(ctx.model) || useProxyNativeTools)) toolNames.push(WEB_SEARCH_TOOL_NAME);
	if (config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || useProxyNativeTools)) toolNames.push(IMAGE_GENERATION_TOOL_NAME);
	if (Array.isArray(ctx.model?.input) && ctx.model.input.includes("image")) toolNames.push(VIEW_IMAGE_TOOL_NAME);
	return toolNames;
}

function getAdapterOwnedToolNames(config: CodexConversionConfig): string[] {
	if (config.mode === "path") return [...ADAPTER_TOOL_NAMES];
	return [
		...SHELL_ADAPTER_TOOL_NAMES,
		APPLY_PATCH_TOOL_NAME,
		VIEW_IMAGE_TOOL_NAME,
		...(config.tools.webRun ? [WEB_SEARCH_TOOL_NAME] : []),
		...(config.tools.imageGeneration ? [IMAGE_GENERATION_TOOL_NAME] : []),
	];
}

function setApplyPatchOnlyStatus(ctx: ExtensionContext, config: CodexConversionConfig): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, config.ui.statusLine ? buildApplyPatchOnlyStatusText(ctx.ui.theme) : undefined);
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
