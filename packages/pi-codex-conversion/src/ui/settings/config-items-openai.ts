import type { Theme } from "@earendil-works/pi-coding-agent";
import {
	type CodexConversionConfig,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	normalizeCodexVerbosity,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, projectToggle, setting, toggle } from "./config-items-shared.ts";

export function buildOpenAISettings(
	config: CodexConversionConfig,
	theme: Theme,
): ConfigSetting[] {
	return [
		toggle("fast", "Fast mode", config.openai.fast, (enabled, current) => ({
			...current,
			openai: { ...current.openai, fast: enabled },
		})),
		projectToggle(
			"cacheKeepalive",
			"Experimental cache keepalive",
			config.openai.cacheKeepalive,
		),
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
			config.openai.proxyResponsesLite,
			(enabled, current) => ({
				...current,
				openai: { ...current.openai, proxyResponsesLite: enabled },
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
		),
		setting({
			id: "diagnosticsHeader",
			label: theme.fg("dim", "Diagnostics"),
			currentValue: "",
		}),
		toggle(
			"cacheDiagnosticsStatus",
			"Cache status line",
			config.openai.cacheDiagnostics !== "off",
			(enabled, current) => ({
				...current,
				openai: {
					...current.openai,
					cacheDiagnostics: enabled ? "status" : "off",
				},
			}),
		),
		toggle(
			"cacheDiagnosticsLog",
			"Cache log file",
			config.openai.cacheDiagnostics === "status-and-log",
			(enabled, current) => ({
				...current,
				openai: {
					...current.openai,
					cacheDiagnostics: enabled
						? "status-and-log"
						: current.openai.cacheDiagnostics === "off"
							? "off"
							: "status",
				},
			}),
		),
	];
}
