import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../../adapter/activation/runtime-plan.ts";
import { type ConfigSetting, setting } from "./config-items-shared.ts";

export const COMPACTION_METHOD_LABELS = {
	pi: "Pi summary",
	v2: "Codex V2",
	both: "Both",
} as const;

export function buildContextSettings(
	config: CodexConversionConfig,
	ctx: Pick<ExtensionContext, "model">,
): ConfigSetting[] {
	const plan = resolveCodexRuntimePlan(ctx, config);
	const supportsV2 = isAdapterRuntime(plan) && plan.effectiveOpenAICodex;
	const { method, v2UserMessageRetention } = config.compaction;
	return [
		setting(
			{
				id: "compactionMethod",
				label: "Compaction method",
				description: supportsV2
					? "Pi summary is readable. Codex V2 is encrypted. Both adds a readable Pi summary for provider switching, at extra cost."
					: "This route uses Pi summary. Codex V2 and Both require an active Codex or configured compatible passthrough adapter. The saved choice is retained.",
				currentValue: COMPACTION_METHOD_LABELS[method],
				values: supportsV2 ? Object.values(COMPACTION_METHOD_LABELS) : ["Pi summary"],
			},
			(value, current) => ({
				...current,
				compaction: { ...current.compaction, method: value === "Both" ? "both" : value === "Codex V2" ? "v2" : "pi" },
			}),
		),
		...(method !== "pi" ? [setting(
			{
				id: "v2UserMessageRetention",
				label: "Preserved user messages (V2 only)",
				description: "Token budget for recent user messages kept verbatim alongside the encrypted checkpoint, including when using Both.",
				currentValue: v2UserMessageRetention + "k",
				values: V2_USER_MESSAGE_RETENTION_OPTIONS.map((value) => value + "k"),
			},
			(value, current) => ({
				...current,
				compaction: { ...current.compaction,
					v2UserMessageRetention: normalizeV2UserMessageRetention(Number.parseInt(value, 10)) ?? current.compaction.v2UserMessageRetention },
			}),
		)] : []),
	];
}
