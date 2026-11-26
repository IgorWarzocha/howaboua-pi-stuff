import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { supportsCodexReasoningUpdates } from "../reasoning-updates.ts";
import {
	isGpt6ModelId,
	supportsResponsesLiteModel,
} from "../../providers/openai-codex/responses-lite-model.ts";
import {
	isDefaultAdapterModel,
	isCodexTransportContext,
	isOpenAIResponsesContext,
	isResponsesContext,
} from "../prompt/model-support.ts";
import type { CodexConversionConfig } from "./config.ts";
import { FAST_MODE_FAMILIES } from "./config-contract.ts";
import type { ExecutionMode } from "./execution-mode.ts";
import { getModelScopeOverride } from "./model-scope.ts";
import type { AdapterState } from "./state.ts";
import {
	EXEC_TOOL_NAMES,
	NESTED_ADAPTER_TOOL_NAMES,
	TS_NOTEBOOK_TOOL_NAMES,
} from "./tool-set.ts";

type RuntimeContext = Pick<ExtensionContext, "model">;
export type ResponsesFormat = "responses" | "responses-lite";

interface RuntimePlanBase {
	kind: "inactive" | ExecutionMode;
	toolNames: string[];
	ownedToolNames: string[];
	configuredProvider: boolean;
	codexTransport: boolean;
	codexOrConfiguredResponses: boolean;
	nativeCompaction: boolean;
	nativeReplay: boolean;
	autoReasoning: boolean;
}

export interface InactiveRuntimePlan extends RuntimePlanBase {
	kind: "inactive";
	missingToolNames?: string[];
	toolNames: [];
	responsesFormat: undefined;
}

export interface ActiveRuntimePlan extends RuntimePlanBase {
	kind: ExecutionMode;
	nestedToolNames: string[];
	responsesFormat: ResponsesFormat;
}

export type AdapterRuntimePlan = InactiveRuntimePlan | ActiveRuntimePlan;

const ALL_ADAPTER_TOOL_NAMES = [
	...NESTED_ADAPTER_TOOL_NAMES,
	...TS_NOTEBOOK_TOOL_NAMES,
];

function configuredProvider(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
): boolean {
	const provider = ctx.model?.provider?.trim().toLowerCase();
	return Boolean(
		provider &&
		isResponsesContext(ctx) &&
		config.scope.additionalProviders.includes(provider),
	);
}

function proxySupportsResponsesLite(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
): boolean {
	if (
		!config.openai.proxyResponsesLite ||
		!configuredProvider(ctx, config) ||
		!isOpenAIResponsesContext(ctx)
	)
		return false;
	const modelId = ctx.model?.id;
	if (!modelId) return false;
	const id = modelId.includes("/")
		? (modelId.split("/").pop() ?? modelId)
		: modelId;
	return (
		isGpt6ModelId(id) ||
		/^gpt-5\.6(?:-(?:luna|terra|sol))?$/.test(id.toLowerCase())
	);
}

function usesResponsesLite(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
): boolean {
	return isCodexTransportContext(ctx)
		? supportsResponsesLiteModel(ctx.model?.id)
		: proxySupportsResponsesLite(ctx, config);
}

/** Provider feature negotiation shares the configured method; route eligibility is resolved below. */
export function nativeCompactionConfigured(
	compaction: CodexConversionConfig["compaction"] | undefined,
): boolean {
	return compaction !== undefined && compaction.method !== "pi";
}

export function hasCodexTransportConfigChanged(
	previous: CodexConversionConfig,
	next: CodexConversionConfig,
): boolean {
	return (
		next.executionMode !== previous.executionMode ||
		next.prompt.heavySystemPromptOverwrite !==
			previous.prompt.heavySystemPromptOverwrite ||
		[...FAST_MODE_FAMILIES, "other" as const].some(
			(family) => next.openai.fast[family] !== previous.openai.fast[family],
		) ||
		next.openai.daybreak !== previous.openai.daybreak ||
		nativeCompactionConfigured(next.compaction) !==
			nativeCompactionConfigured(previous.compaction)
	);
}

export function resolveAdapterRuntimePlan(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
	executionMode?: ExecutionMode,
): AdapterRuntimePlan {
	const isConfigured = configuredProvider(ctx, config);
	const codexTransport = isCodexTransportContext(ctx);
	const codexOrConfiguredResponses = codexTransport || isConfigured;
	const base = {
		ownedToolNames: ALL_ADAPTER_TOOL_NAMES,
		configuredProvider: isConfigured,
		codexTransport,
		codexOrConfiguredResponses,
		nativeCompaction: false,
		nativeReplay: false,
		autoReasoning: false,
	};
	const { mode, modelOverrides } = config.scope;
	const active =
		ctx.model &&
		(getModelScopeOverride(modelOverrides, ctx.model) ??
			(mode === "all" ||
				(mode === "automatic" &&
					(isConfigured || isDefaultAdapterModel(ctx.model)))));
	if (!active)
		return {
			...base,
			kind: "inactive",
			toolNames: [],
			responsesFormat: undefined,
		};
	base.nativeReplay = codexOrConfiguredResponses;
	const nativeCompaction =
		codexOrConfiguredResponses && nativeCompactionConfigured(config.compaction);
	base.autoReasoning =
		config.tools.autoReasoning && supportsCodexReasoningUpdates(ctx.model);
	const kind = executionMode ?? config.executionMode;
	return {
		...base,
		kind,
		toolNames: [...(kind === "ts" ? TS_NOTEBOOK_TOOL_NAMES : EXEC_TOOL_NAMES)],
		nestedToolNames: NESTED_ADAPTER_TOOL_NAMES,
		responsesFormat: usesResponsesLite(ctx, config)
			? "responses-lite"
			: "responses",
		nativeCompaction,
	};
}

export function resolveAdapterRuntimePlanForState(
	ctx: RuntimeContext,
	state: Pick<AdapterState, "config" | "executionMode" | "availableToolNames">,
): AdapterRuntimePlan {
	const plan = resolveAdapterRuntimePlan(
		ctx,
		state.config,
		state.executionMode,
	);
	const missingToolNames =
		state.availableToolNames === undefined
			? []
			: plan.toolNames.filter(
					(name) => !state.availableToolNames?.includes(name),
				);
	if (!missingToolNames.length) return plan;
	return {
		...plan,
		kind: "inactive",
		toolNames: [],
		missingToolNames,
		responsesFormat: undefined,
		nativeCompaction: false,
		nativeReplay: false,
		autoReasoning: false,
	};
}

export function isAdapterRuntime(
	plan: AdapterRuntimePlan,
): plan is ActiveRuntimePlan {
	return plan.kind !== "inactive";
}

export const ALL_CODEX_ADAPTER_TOOL_NAMES = ALL_ADAPTER_TOOL_NAMES;
