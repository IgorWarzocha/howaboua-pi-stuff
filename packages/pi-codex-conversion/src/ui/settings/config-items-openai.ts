import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	normalizeCodexVerbosity,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, setting, toggle } from "./config-items-shared.ts";

export function buildOpenAISettings(
	config: CodexConversionConfig,
	theme: Theme,
): ConfigSetting[] {
	return [
		toggle("fast", "Fast mode", config.openai.fast, (enabled, current) => ({
			...current,
			openai: { ...current.openai, fast: enabled },
		})),
		setting(
			{
				id: "verbosity",
				label: "Verbosity",
				currentValue: config.openai.verbosity,
				values: ["low", "medium", "high"],
			},
			(value, current) => ({
				...current,
				openai: {
					...current.openai,
					verbosity:
						normalizeCodexVerbosity(value) ??
						DEFAULT_CODEX_CONVERSION_CONFIG.openai.verbosity,
				},
			}),
		),
		setting({
			id: "transportHeader",
			label: theme.fg("dim", "Transport"),
			currentValue: "",
		}),
		toggle(
			"responsesLite",
			"Proxy Responses Lite",
			config.beta.responsesLite,
			(enabled, current) => ({
				...current,
				beta: { ...current.beta, responsesLite: enabled },
			}),
		),
		toggle(
			"forceCachedWebSockets",
			"Cached WebSocket upgrade",
			config.openai.forceCachedWebSockets,
			(enabled, current) => ({
				...current,
				openai: { ...current.openai, forceCachedWebSockets: enabled },
			}),
		),
		setting(
			{
				id: "harnessIdentifierHeader",
				label: "Harness identifier header",
				currentValue: config.openai.harnessIdentifierHeader
					? "pi-codex-conversion <3"
					: "off",
				values: ["off", "pi-codex-conversion <3"],
			},
			(value, current) => ({
				...current,
				openai: {
					...current.openai,
					harnessIdentifierHeader: value !== "off",
				},
			}),
		),
		setting({
			id: "compactionHeader",
			label: theme.fg("dim", "Compaction"),
			currentValue: "",
		}),
		toggle(
			"responsesCompaction",
			"Responses compaction V2",
			config.compaction.responsesCompaction,
			(enabled, current) => ({
				...current,
				compaction: { ...current.compaction, responsesCompaction: enabled },
			}),
		),
		setting(
			{
				id: "v2UserMessageRetention",
				label: "Preserved user messages",
				currentValue: `${config.beta.v2UserMessageRetention ?? 64}k${(config.beta.v2UserMessageRetention ?? 64) === 64 ? " (Codex native)" : ""}`,
				values: V2_USER_MESSAGE_RETENTION_OPTIONS.map(
					(value) => `${value}k${value === 64 ? " (Codex native)" : ""}`,
				),
			},
			(value, current) => ({
				...current,
				beta: {
					...current.beta,
					v2UserMessageRetention:
						normalizeV2UserMessageRetention(Number.parseInt(value, 10)) ?? 64,
				},
			}),
		),
	];
}
