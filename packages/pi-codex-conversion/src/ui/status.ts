import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AdapterState } from "../adapter/activation/state.ts";
import type { AdapterRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import { STATUS_KEY, buildStatusText } from "../adapter/activation/tool-set.ts";
import { isResponsesContext } from "../adapter/prompt/model-support.ts";
import { resolveFastModeServiceTier } from "../adapter/activation/fast-mode.ts";
import { codexUltrafastCostMultiplier } from "../providers/openai-codex/usage.ts";

export function renderCodexStatus(
	ctx: ExtensionContext,
	state: AdapterState,
	plan: Extract<AdapterRuntimePlan, { kind: "normal" | "code" | "ts" | "vm" }>,
): void {
	if (!ctx.hasUI) return;
	if (!state.config.ui.statusLine) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		return;
	}
	const config = state.config;
	const fast = plan.codexOrConfiguredResponses
		? resolveFastModeServiceTier(config.openai.fast, ctx.model?.id)
		: undefined;
	ctx.ui.setStatus(
		STATUS_KEY,
		buildStatusText(
			{
				executionMode: plan.kind,
				useOnAllModels: config.scope.allProviders === "on",
				additionalProvider: plan.configuredProvider,
				fast,
				baseTierEstimate:
					fast === "ultrafast" &&
					codexUltrafastCostMultiplier(ctx.model?.id) === undefined,
				daybreak: plan.codexTransport ? config.openai.daybreak : undefined,
				compaction: plan.nativeCompaction,
				usageStatus: state.usageStatus,
				...(isResponsesContext(ctx)
					? { verbosity: config.openai.verbosity }
					: {}),
			},
			ctx.ui.theme,
		),
	);
}
