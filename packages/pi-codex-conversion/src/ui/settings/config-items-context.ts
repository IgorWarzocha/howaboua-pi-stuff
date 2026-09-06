import {
	type CodexConversionConfig,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

export function buildContextSettings(config: CodexConversionConfig): ConfigSetting[] {
	return [
		setting(
			{
				id: "contextManagement",
				label: "Context management (experimental)",
				description: "Local: Codex-style notes and history in local files. Tree: recall through Pi trees. Remote: server-backed.",
				currentValue: config.compaction.contextManagement === "remote" ? "remote (encrypted)" : config.compaction.contextManagement,
				values: ["off", "local", "tree", "remote (encrypted)"],
			},
			(value, current) => ({
				...current,
				compaction: {
					...current.compaction,
					contextManagement:
						value === "remote (encrypted)" ? "remote"
							: value === "local" || value === "tree" ? value : "off",
					...(value !== "off"
						? { responsesCompaction: false, portableSummary: false }
						: { hybridCompaction: false }),
				},
			}),
		),
		...(config.compaction.contextManagement === "off" ? [] : [setting(
			{ id: "hybridCompaction", label: "Hybrid compaction",
				currentValue: config.compaction.hybridCompaction ? "on" : "off", values: ["off", "on"],
				description: "Allow standard compaction on overflow, rollover or /compact: V2 where supported, Pi summary elsewhere." },
			(value, current) => ({
				...current,
				compaction: { ...current.compaction, hybridCompaction: value === "on" },
			}),
		)]),
		...(config.compaction.contextManagement === "off" ? [toggle(
			"responsesCompaction",
			"Responses compaction V2 (Codex)",
			config.compaction.responsesCompaction,
			(enabled, current) => ({
				...current,
				compaction: {
					...current.compaction,
					responsesCompaction: enabled,
					...(enabled ? {} : { portableSummary: false }),
				},
			}),
			"Use an encrypted Codex checkpoint instead of a Pi summary; also supported by configured passthrough proxies.",
		),
		toggle(
			"portableSummary",
			"Parallel Pi summary",
			config.compaction.portableSummary,
			(enabled, current) => ({
				...current,
				compaction: {
					...current.compaction,
					portableSummary: enabled,
					...(enabled
							? { responsesCompaction: true }
							: {}),
				},
			}),
			"Also save a readable Pi summary for switching providers. Enables V2.",
		)] : []),
		...(config.compaction.responsesCompaction || config.compaction.hybridCompaction ? [setting(
			{
				id: "v2UserMessageRetention",
				label: "Preserved user messages (V2)",
				description: "Token budget for recent user messages kept verbatim alongside the encrypted V2 checkpoint.",
				currentValue: `${config.compaction.v2UserMessageRetention}k${config.compaction.v2UserMessageRetention === 64 ? " (Codex native)" : ""}`,
				values: V2_USER_MESSAGE_RETENTION_OPTIONS.map(
					(value) => `${value}k${value === 64 ? " (Codex native)" : ""}`,
				),
			},
			(value, current) => ({
				...current,
				compaction: {
					...current.compaction,
					v2UserMessageRetention:
						normalizeV2UserMessageRetention(Number.parseInt(value, 10)) ?? 64,
				},
			}),
		)] : []),
	];
}
