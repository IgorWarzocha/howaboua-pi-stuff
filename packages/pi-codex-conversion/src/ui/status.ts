import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../adapter/activation/state.ts";
import type { CodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import { STATUS_KEY, buildStatusText } from "../adapter/activation/tool-set.ts";
import { isResponsesContext } from "../adapter/prompt/codex-model.ts";
import { resolveFastModeServiceTier } from "../adapter/activation/fast-mode.ts";

export function renderCodexStatus(ctx: ExtensionContext, state: AdapterState, plan: Extract<CodexRuntimePlan, { kind: "normal" | "code" | "notebook" }>): void {
	if (!ctx.hasUI) return;
	if (!state.config.ui.statusLine) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const config = state.config;
	const fast = plan.effectiveOpenAICodex ? resolveFastModeServiceTier(config.openai.fast, ctx.model?.id) : undefined;
	ctx.ui.setStatus(STATUS_KEY, buildStatusText({
		mode: plan.kind,
		useOnAllModels: config.scope.allProviders === "on",
		additionalProvider: plan.configuredProvider,
		fast,
		baseTierEstimate: fast === "ultrafast" && ctx.model?.id !== "gpt-6-astra" && ctx.model?.id !== "gpt-6.1-sol",
		daybreak: plan.codexTransport ? config.openai.daybreak : undefined,
		contextManagement: plan.contextManagementMode,
		compaction: plan.nativeCompaction,
		usageStatus: state.usageStatus,
		...(isResponsesContext(ctx) ? { verbosity: config.openai.verbosity } : {}),
	}, ctx.ui.theme));
}
