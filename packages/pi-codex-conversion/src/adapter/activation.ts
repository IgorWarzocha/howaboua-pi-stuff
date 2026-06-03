import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isCodexLikeContext, isOpenAICodexContext, isResponsesContext } from "./codex-model.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { AdapterState } from "./state.ts";
import {
	APPLY_PATCH_TOOL_NAME,
	CORE_ADAPTER_TOOL_NAMES,
	DEFAULT_TOOL_NAMES,
	IMAGE_GENERATION_TOOL_NAME,
	APPLY_PATCH_ONLY_STATUS_TEXT,
	STATUS_KEY,
	VIEW_IMAGE_TOOL_NAME,
	WEB_SEARCH_TOOL_NAME,
	SHELL_ADAPTER_TOOL_NAMES,
	buildStatusText,
} from "./tool-set.ts";
import { supportsNativeImageGeneration } from "../tools/image-generation-tool.ts";
import { supportsNativeWebSearch } from "../tools/web-search-tool.ts";

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
	if (config.applyPatchOnly) return false;
	return config.useOnAllModels || isConfiguredAdapterProvider(ctx, config) || isCodexLikeContext(ctx);
}

function isConfiguredAdapterProvider(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	if (!config.useAdapterProviders) return false;
	const provider = ctx.model?.provider?.trim().toLowerCase();
	return Boolean(provider && config.adapterProviders.includes(provider));
}

export function shouldUseApplyPatchOnly(ctx: ExtensionContext, config: CodexConversionConfig): boolean {
	return config.applyPatchOnly && isCodexLikeContext(ctx);
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
	if (!config.statusLine) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const statusConfig = getStatusConfig(ctx, config);
	ctx.ui.setStatus(STATUS_KEY, enabled ? buildStatusText(statusConfig) : undefined);
}

function setApplyPatchOnlyStatus(ctx: ExtensionContext, config: CodexConversionConfig): void {
	if (!ctx.hasUI) return;
	ctx.ui.setStatus(STATUS_KEY, config.statusLine ? APPLY_PATCH_ONLY_STATUS_TEXT : undefined);
}

function getStatusConfig(ctx: ExtensionContext, config: CodexConversionConfig): Parameters<typeof buildStatusText>[0] {
	const showOpenAICodexFlags = isOpenAICodexContext(ctx);
	const showResponsesVerbosity = isResponsesContext(ctx);
	return {
		useOnAllModels: config.useOnAllModels,
		useAdapterProviders: config.useAdapterProviders && isConfiguredAdapterProvider(ctx, config),
		fast: showOpenAICodexFlags && config.fast,
		webSearch: showOpenAICodexFlags && !config.applyPatchOnly && config.webSearch && supportsNativeWebSearch(ctx.model),
		imageGeneration: showOpenAICodexFlags && !config.applyPatchOnly && config.imageGeneration && supportsNativeImageGeneration(ctx.model),
		compaction: { enabled: Boolean(config.responsesCompaction), model: config.compactionModel, reasoning: config.compactionReasoning },
		...(showResponsesVerbosity ? { verbosity: config.verbosity } : {}),
	};
}

function getAdapterToolNames(ctx: ExtensionContext, config: CodexConversionConfig): string[] {
	const toolNames = [...CORE_ADAPTER_TOOL_NAMES];
	if (config.webSearch && supportsNativeWebSearch(ctx.model)) {
		toolNames.push(WEB_SEARCH_TOOL_NAME);
	}
	if (config.imageGeneration && supportsNativeImageGeneration(ctx.model)) {
		toolNames.push(IMAGE_GENERATION_TOOL_NAME);
	}
	if (Array.isArray(ctx.model?.input) && ctx.model.input.includes("image")) {
		toolNames.push(VIEW_IMAGE_TOOL_NAME);
	}
	return toolNames;
}

function getAdapterOwnedToolNames(config: CodexConversionConfig): string[] {
	return [
		...SHELL_ADAPTER_TOOL_NAMES,
		APPLY_PATCH_TOOL_NAME,
		VIEW_IMAGE_TOOL_NAME,
		...(config.webSearch ? [WEB_SEARCH_TOOL_NAME] : []),
		...(config.imageGeneration ? [IMAGE_GENERATION_TOOL_NAME] : []),
	];
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
