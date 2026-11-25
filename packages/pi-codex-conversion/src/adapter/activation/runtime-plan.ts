import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { supportsCodexReasoningUpdates } from "../reasoning-updates.ts";
import { supportsViewImageInputs } from "../tool-support.ts";
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
import type { AdapterState } from "./state.ts";
import {
	APPLY_PATCH_TOOL_NAME,
	EXEC_TOOL_NAMES,
	CORE_ADAPTER_TOOL_NAMES,
	TS_NOTEBOOK_TOOL_NAMES,
	SHELL_ADAPTER_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
} from "./tool-set.ts";

type RuntimeContext = Pick<ExtensionContext, "model">;
export type ResponsesFormat = "responses" | "responses-lite";

interface RuntimePlanBase {
	kind: "inactive" | "normal" | "code" | "ts" | "vm";
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

export interface NormalRuntimePlan extends RuntimePlanBase {
	kind: "normal";
	responsesFormat: "responses";
}

export interface CodeRuntimePlan extends RuntimePlanBase {
	kind: "code";
	responsesFormat: ResponsesFormat;
}

export interface TsRuntimePlan extends RuntimePlanBase {
	kind: "ts";
	responsesFormat: ResponsesFormat;
}

export interface VmRuntimePlan extends RuntimePlanBase {
	kind: "vm";
	responsesFormat: ResponsesFormat;
}

export type AdapterRuntimePlan =
	| InactiveRuntimePlan
	| NormalRuntimePlan
	| CodeRuntimePlan
	| TsRuntimePlan
	| VmRuntimePlan;

const ALL_ADAPTER_TOOL_NAMES = [
	"change_reasoning",
	...CORE_ADAPTER_TOOL_NAMES,
	...TS_NOTEBOOK_TOOL_NAMES,
	VIEW_IMAGE_TOOL_NAME,
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

function structuredToolNames(
	ctx: RuntimeContext,
	config: CodexConversionConfig,
): string[] {
	const names = [...CORE_ADAPTER_TOOL_NAMES];
	if (supportsViewImageInputs(ctx.model) || config.tools.viewImageFallback)
		names.push(VIEW_IMAGE_TOOL_NAME);
	return names;
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
	const ownedToolNames = [
		"change_reasoning",
		...SHELL_ADAPTER_TOOL_NAMES,
		...TS_NOTEBOOK_TOOL_NAMES,
		APPLY_PATCH_TOOL_NAME,
		VIEW_IMAGE_TOOL_NAME,
	];
	const base = {
		ownedToolNames,
		configuredProvider: isConfigured,
		codexTransport,
		codexOrConfiguredResponses,
		nativeCompaction: false,
		nativeReplay: false,
		autoReasoning: false,
	};
	const active =
		config.scope.allProviders === "on" ||
		isConfigured ||
		isDefaultAdapterModel(ctx.model);
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
	const configuredExecutionMode = executionMode ?? config.executionMode;
	if (
		configuredExecutionMode === "code" ||
		configuredExecutionMode === "ts" ||
		configuredExecutionMode === "vm"
	) {
		const responsesFormat: ResponsesFormat = usesResponsesLite(ctx, config)
			? "responses-lite"
			: "responses";
		if (configuredExecutionMode === "ts") {
			const tsNotebookPlan = {
				...base,
				toolNames: [...TS_NOTEBOOK_TOOL_NAMES],
				responsesFormat,
				nativeCompaction,
			};
			return { ...tsNotebookPlan, kind: "ts" };
		}
		const execPlan = {
			...base,
			toolNames: [...EXEC_TOOL_NAMES],
			responsesFormat,
			nativeCompaction,
		};
		return configuredExecutionMode === "vm"
			? { ...execPlan, kind: "vm" }
			: { ...execPlan, kind: "code" };
	}
	return {
		...base,
		kind: "normal",
		toolNames: [
			...structuredToolNames(ctx, config),
			...(base.autoReasoning ? ["change_reasoning"] : []),
		],
		responsesFormat: "responses",
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
): plan is NormalRuntimePlan | CodeRuntimePlan | TsRuntimePlan | VmRuntimePlan {
	return (
		plan.kind === "normal" ||
		plan.kind === "code" ||
		plan.kind === "ts" ||
		plan.kind === "vm"
	);
}

export function usesExecTools(
	plan: AdapterRuntimePlan,
): plan is CodeRuntimePlan | TsRuntimePlan | VmRuntimePlan {
	return plan.kind === "code" || plan.kind === "ts" || plan.kind === "vm";
}

export const ALL_CODEX_ADAPTER_TOOL_NAMES = ALL_ADAPTER_TOOL_NAMES;
