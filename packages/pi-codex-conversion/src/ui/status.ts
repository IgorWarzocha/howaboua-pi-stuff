import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../adapter/activation/state.ts";
import type { CodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import { STATUS_KEY, buildStatusText } from "../adapter/activation/tool-set.ts";
import { isResponsesContext } from "../adapter/prompt/codex-model.ts";

export function renderCodexStatus(ctx: ExtensionContext, state: AdapterState, plan: Extract<CodexRuntimePlan, { kind: "normal" | "code" | "notebook" }>): void {
	if (!ctx.hasUI) return;
	if (!state.config.ui.statusLine) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const config = state.config;
	ctx.ui.setStatus(STATUS_KEY, buildStatusText({
		mode: plan.kind,
		useOnAllModels: config.scope.allProviders === "on",
		additionalProvider: plan.configuredProvider,
		fast: plan.effectiveOpenAICodex && config.openai.fast,
		webSearch: plan.toolNames.includes("web_run"),
		imageGeneration: plan.toolNames.includes("imagegen"),
		compaction: plan.nativeCompaction,
		weeklyUsageLeft: state.weeklyUsageLeft,
		...(isResponsesContext(ctx) ? { verbosity: config.openai.verbosity } : {}),
	}, ctx.ui.theme));
}
