import {
	type CodexConversionConfig,
	DEFAULT_CODEX_CONVERSION_CONFIG,
	LUNA_CACHE_KEEPALIVE_MINUTES_OPTIONS,
	normalizeCodexVerbosity,
	normalizeV2UserMessageRetention,
	V2_USER_MESSAGE_RETENTION_OPTIONS,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, projectCacheKeepalive, setting, toggle } from "./config-items-shared.ts";

export function buildOpenAISettings(
	config: CodexConversionConfig,
): ConfigSetting[] {
	return [
		toggle("fast", "Fast mode", config.openai.fast, (enabled, current) => ({
			...current,
			openai: { ...current.openai, fast: enabled },
		})),
		{
			item: {
				id: "lunaCacheKeepaliveMinutes",
				label: "Luna cache keepalive (global)",
				currentValue: config.openai.lunaCacheKeepaliveMinutes === 0
					? "off"
					: `${config.openai.lunaCacheKeepaliveMinutes} mins`,
				values: LUNA_CACHE_KEEPALIVE_MINUTES_OPTIONS.map((minutes) => minutes === 0 ? "off" : `${minutes} mins`),
			},
			action: "global-luna-cache-keepalive",
		},
		projectCacheKeepalive(
			"cacheKeepalive",
			"Sol/Terra cache keepalive (this project)",
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
		toggle(
			"responsesCompaction",
			"Responses compaction V2",
			config.compaction.responsesCompaction,
			(enabled, current) => ({
				...current,
				compaction: {
					...current.compaction,
					responsesCompaction: enabled,
					...(enabled ? { contextManagement: "off" as const } : {}),
					...(enabled ? {} : { portableSummary: false }),
				},
			}),
		),
		toggle(
			"portableSummary",
			"Parallel Pi-native compaction",
			config.compaction.portableSummary,
			(enabled, current) => ({
				...current,
				compaction: {
					...current.compaction,
					portableSummary: enabled,
					...(enabled
						? { responsesCompaction: true, contextManagement: "off" as const }
						: {}),
				},
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
		setting(
			{
				id: "cacheDiagnostics",
				label: "Cache diagnostics",
				currentValue: formatCacheDiagnostics(config.openai.cacheDiagnostics),
				values: ["Off", "Status", "Status + log"],
			},
			(value, current) => ({
				...current,
				openai: {
					...current.openai,
					cacheDiagnostics: parseCacheDiagnostics(value),
				},
			}),
		),
	];
}

function formatCacheDiagnostics(
	mode: CodexConversionConfig["openai"]["cacheDiagnostics"],
): string {
	if (mode === "status-and-log") return "Status + log";
	if (mode === "status") return "Status";
	return "Off";
}

function parseCacheDiagnostics(
	value: string,
): CodexConversionConfig["openai"]["cacheDiagnostics"] {
	if (value === "Status + log") return "status-and-log";
	if (value === "Status") return "status";
	return "off";
}
