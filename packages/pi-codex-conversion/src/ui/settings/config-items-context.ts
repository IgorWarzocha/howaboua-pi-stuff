import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	normalizeHistoryStorage,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../../adapter/activation/runtime-plan.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

export const CONTINUITY_LABELS = {
	compaction: "Compaction",
	notes: "Notes and history",
	"notes-and-compaction": "Notes + history + compaction",
} as const;

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
	const { continuity, historyStorage, method, v2UserMessageRetention } = config.compaction;
	return [
		setting(
			{
				id: "continuity",
				label: "Continuity strategy",
				description: "Compaction carries a checkpoint. Notes and history rolls over with saved notes. Notes + history + compaction adds a checkpoint while keeping history lookup. Changing strategy preserves the current context. Notes-based strategies are experimental.",
				currentValue: CONTINUITY_LABELS[continuity],
				values: Object.values(CONTINUITY_LABELS),
			},
			(value, current) => ({
				...current,
				compaction: { ...current.compaction,
					continuity: value === CONTINUITY_LABELS.notes ? "notes" : value === CONTINUITY_LABELS["notes-and-compaction"] ? "notes-and-compaction" : "compaction" },
			}),
		),
		...(continuity === "compaction" ? [] : [setting(
			{
				id: "historyStorage",
				label: "History and notes storage",
				description: "Local: Pi session files. Tree: archived Pi branches. Remote: encrypted Codex service. Changing storage does not copy saved notes or change continuity.",
				currentValue: historyStorage === "local" ? "Local" : historyStorage === "tree" ? "Tree" : "Remote",
				values: plan.codexTransport ? ["Local", "Tree", "Remote"] : ["Local", "Tree"],
			},
			(value, current) => ({
				...current,
				compaction: { ...current.compaction, historyStorage: normalizeHistoryStorage(value.toLowerCase()) ?? current.compaction.historyStorage },
			}),
		), toggle(
			"shareSubagentContext",
			"Share subagent context",
			config.compaction.shareSubagentContext,
			(enabled, current) => ({
				...current,
				compaction: { ...current.compaction, shareSubagentContext: enabled },
			}),
			"Share notes and history with new subagents through a compatible integration. Existing agents keep their identity.",
		)]),
		...(continuity === "notes" ? [] : [setting(
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
		)]),
		...(continuity !== "notes" && method !== "pi" ? [setting(
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
