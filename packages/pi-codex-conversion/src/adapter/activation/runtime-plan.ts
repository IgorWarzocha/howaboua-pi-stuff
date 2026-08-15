import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { supportsNativeImageGeneration, supportsNativeWebSearch, supportsViewImageInputs } from "../tool-support.ts";
import { supportsResponsesLiteModel } from "../../providers/openai-codex/responses-lite-model.ts";
import { canonicalCodexAliasModelKey, isCanonicalCodexAliasModel, isCodexLikeModel, isCodexTransportContext, isOpenAIResponsesContext, isResponsesContext } from "../prompt/codex-model.ts";
import type { CodexConversionConfig } from "./config.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import type { AdapterState } from "./state.ts";
import {
	APPLY_PATCH_TOOL_NAME,
	CODE_MODE_TOOL_NAMES,
	CORE_ADAPTER_TOOL_NAMES,
	IMAGE_GENERATION_TOOL_NAME,
	NOTEBOOK_MODE_TOOL_NAMES,
	SHELL_ADAPTER_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
	WEB_SEARCH_TOOL_NAME,
} from "./tool-set.ts";

type RuntimeContext = Pick<ExtensionContext, "model">;

interface RuntimePlanBase {
	kind: "inactive" | "extras" | "normal" | "code" | "notebook";
	toolNames: string[];
	ownedToolNames: string[];
	configuredProvider: boolean;
	codexTransport: boolean;
	effectiveOpenAICodex: boolean;
	nativeCompaction: boolean;
}

export interface InactiveRuntimePlan extends RuntimePlanBase {
	kind: "inactive";
	toolNames: [];
	prompt: undefined;
	transport: undefined;
}

export interface ExtrasRuntimePlan extends RuntimePlanBase {
	kind: "extras";
	prompt: undefined;
	transport: "responses";
}

export interface NormalRuntimePlan extends RuntimePlanBase {
	kind: "normal";
	prompt: "normal";
	transport: "responses";
}

export interface CodeRuntimePlan extends RuntimePlanBase {
	kind: "code";
	prompt: "code";
	transport: "responses-lite";
}

export interface NotebookRuntimePlan extends RuntimePlanBase {
	kind: "notebook";
	prompt: "notebook";
	transport: "responses-lite";
}

export type CodexRuntimePlan = InactiveRuntimePlan | ExtrasRuntimePlan | NormalRuntimePlan | CodeRuntimePlan | NotebookRuntimePlan;

const ALL_ADAPTER_TOOL_NAMES = [
	...CORE_ADAPTER_TOOL_NAMES,
	...NOTEBOOK_MODE_TOOL_NAMES,
	WEB_SEARCH_TOOL_NAME,
	IMAGE_GENERATION_TOOL_NAME,
	VIEW_IMAGE_TOOL_NAME,
];

function configuredProvider(ctx: RuntimeContext, config: CodexConversionConfig): boolean {
	const provider = ctx.model?.provider?.trim().toLowerCase();
	return Boolean(provider && isResponsesContext(ctx) && config.scope.additionalProviders.includes(provider));
}

function proxySupportsCodeMode(ctx: RuntimeContext, config: CodexConversionConfig): boolean {
	if (!config.openai.proxyResponsesLite || !configuredProvider(ctx, config) || !isOpenAIResponsesContext(ctx)) return false;
	const modelId = ctx.model?.id;
	if (!modelId) return false;
	const id = modelId.includes("/") ? (modelId.split("/").pop() ?? modelId) : modelId;
	return /^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id.toLowerCase());
}

function codeModeEligible(ctx: RuntimeContext, config: CodexConversionConfig): boolean {
	return isCodexTransportContext(ctx)
		? supportsResponsesLiteModel(ctx.model?.id)
		: proxySupportsCodeMode(ctx, config);
}

function hasExtras(config: CodexConversionConfig): boolean {
	const tools = config.tools;
	return tools.applyPatchOnly || tools.viewImageOnly || tools.webRunOnly || tools.imageGenerationOnly;
}

export function usesCodexProviderFallback(config: CodexConversionConfig): boolean {
	return config.scope.allProviders !== "off";
}

function extraToolNames(ctx: RuntimeContext, config: CodexConversionConfig, codexBacked: boolean): string[] {
	const names: string[] = [];
	if (config.tools.applyPatchOnly) names.push(APPLY_PATCH_TOOL_NAME);
	if (config.tools.viewImageOnly && (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback)) names.push(VIEW_IMAGE_TOOL_NAME);
	if (config.tools.webRunOnly && (supportsNativeWebSearch(ctx.model) || codexBacked)) names.push(WEB_SEARCH_TOOL_NAME);
	if (config.tools.imageGenerationOnly && (supportsNativeImageGeneration(ctx.model) || codexBacked)) names.push(IMAGE_GENERATION_TOOL_NAME);
	return names;
}

function normalToolNames(ctx: RuntimeContext, config: CodexConversionConfig, codexBacked: boolean): string[] {
	const names = [...CORE_ADAPTER_TOOL_NAMES];
	if (config.tools.webRun && (supportsNativeWebSearch(ctx.model) || codexBacked)) names.push(WEB_SEARCH_TOOL_NAME);
	if (config.tools.imageGeneration && (supportsNativeImageGeneration(ctx.model) || codexBacked)) names.push(IMAGE_GENERATION_TOOL_NAME);
	if (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback) names.push(VIEW_IMAGE_TOOL_NAME);
	return names;
}

export function resolveCodexRuntimePlan(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
	executionMode?: ExecutionMode,
	options: { canonicalAliasEndpointTrusted?: boolean | undefined } = {},
): CodexRuntimePlan {
	const isConfigured = configuredProvider(ctx, config);
	const codexTransport = isCodexTransportContext(ctx);
	const effectiveOpenAICodex = codexTransport || isConfigured;
	const ownedToolNames = [
		...SHELL_ADAPTER_TOOL_NAMES,
		...NOTEBOOK_MODE_TOOL_NAMES,
		APPLY_PATCH_TOOL_NAME,
		VIEW_IMAGE_TOOL_NAME,
		...(config.tools.webRun ? [WEB_SEARCH_TOOL_NAME] : []),
		...(config.tools.imageGeneration ? [IMAGE_GENERATION_TOOL_NAME] : []),
	];
	const base = {
		ownedToolNames,
		configuredProvider: isConfigured,
		codexTransport,
		effectiveOpenAICodex,
		nativeCompaction: false,
	};
	const extras = hasExtras(config)
		&& (config.scope.allProviders === "extras"
			|| (config.voiceFeaturesOnly && config.scope.allProviders === "on")
			|| (config.scope.allProviders === "off" && (isConfigured || isCodexLikeModel(ctx.model))));
	const codexBacked = usesCodexProviderFallback(config) || isConfigured;
	if (extras) {
		return { ...base, kind: "extras", toolNames: extraToolNames(ctx, config, codexBacked), prompt: undefined, transport: "responses" };
	}
	if (config.voiceFeaturesOnly) return { ...base, kind: "inactive", toolNames: [], prompt: undefined, transport: undefined };

	const canonicalAliasTrusted = !isCanonicalCodexAliasModel(ctx.model)
		|| options.canonicalAliasEndpointTrusted !== false;
	const active = canonicalAliasTrusted
		&& (config.scope.allProviders === "on" || isConfigured || isCodexLikeModel(ctx.model));
	if (!active) return { ...base, kind: "inactive", toolNames: [], prompt: undefined, transport: undefined };
	const nativeCompaction = config.compaction.responsesCompaction && effectiveOpenAICodex;
	const configuredExecutionMode = executionMode ?? config.executionMode;
	const requestedCodeMode = configuredExecutionMode === "code" || configuredExecutionMode === "notebook"
		? configuredExecutionMode
		: configuredExecutionMode === "normal"
			? undefined
			: undefined;
	if (requestedCodeMode && codeModeEligible(ctx, config)) {
		if (requestedCodeMode === "notebook") {
			return { ...base, kind: "notebook", toolNames: [...NOTEBOOK_MODE_TOOL_NAMES], prompt: "notebook", transport: "responses-lite", nativeCompaction };
		}
		return { ...base, kind: "code", toolNames: [...CODE_MODE_TOOL_NAMES], prompt: "code", transport: "responses-lite", nativeCompaction };
	}
	return {
		...base,
		kind: "normal",
		toolNames: normalToolNames(ctx, config, codexBacked),
		prompt: "normal",
		transport: "responses",
		nativeCompaction,
	};
}

export function resolveCodexRuntimePlanForState(
	ctx: RuntimeContext,
	state: Pick<AdapterState, "config" | "canonicalAliasEndpoint" | "executionMode">,
): CodexRuntimePlan {
	const model = ctx.model;
	if (!model || !isCanonicalCodexAliasModel(model)) return resolveCodexRuntimePlan(ctx, state.config, state.executionMode);
	const endpoint = state.canonicalAliasEndpoint;
	const trusted = endpoint?.modelKey === canonicalCodexAliasModelKey(model) && endpoint.trusted;
	return resolveCodexRuntimePlan(ctx, state.config, state.executionMode, { canonicalAliasEndpointTrusted: trusted });
}

export function isAdapterRuntime(plan: CodexRuntimePlan): plan is NormalRuntimePlan | CodeRuntimePlan | NotebookRuntimePlan {
	return plan.kind === "normal" || plan.kind === "code" || plan.kind === "notebook";
}

export function isCodeModeRuntime(plan: CodexRuntimePlan): plan is CodeRuntimePlan | NotebookRuntimePlan {
	return plan.kind === "code" || plan.kind === "notebook";
}

export const ALL_CODEX_ADAPTER_TOOL_NAMES = ALL_ADAPTER_TOOL_NAMES;
