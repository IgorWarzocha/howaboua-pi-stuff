import {
	type AllProvidersMode,
	type CacheDiagnosticsMode,
	type CodexVerbosity,
	type ContextManagementMode,
	DEFAULT_VOICE_CONTEXT_REASONING,
	type DictationShortcutMode,
	LUNA_CACHE_KEEPALIVE_MINUTES_OPTIONS,
	type LunaCacheKeepaliveMinutes,
	REALTIME_V3_VOICES,
	type RealtimeV3Voice,
	type V2UserMessageRetention,
	VOICE_CONTEXT_REASONING_LEVELS,
	type VoiceContextReasoning,
} from "./config-contract.ts";
import { normalizeOptionalString } from "./config-values.ts";

export { isObject } from "./config-values.ts";

export function normalizeAllProvidersMode(
	value: unknown,
): AllProvidersMode | undefined {
	if (value === true) return "on";
	if (value === false) return "off";
	return value === "off" || value === "on" || value === "extras"
		? value
		: undefined;
}

export function normalizeContextManagementMode(
	value: unknown,
): ContextManagementMode | undefined {
	return value === "off" ||
		value === "local" ||
		value === "tree" ||
		value === "remote"
		? value
		: undefined;
}

export function normalizeCodexVerbosity(
	value: unknown,
): CodexVerbosity | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	return normalized === "low" ||
		normalized === "medium" ||
		normalized === "high"
		? normalized
		: undefined;
}

export function normalizeCacheDiagnosticsMode(
	value: unknown,
): CacheDiagnosticsMode | undefined {
	return value === "off" || value === "status" || value === "status-and-log"
		? value
		: undefined;
}

export function normalizeLunaCacheKeepaliveMinutes(
	value: unknown,
): LunaCacheKeepaliveMinutes | undefined {
	return (LUNA_CACHE_KEEPALIVE_MINUTES_OPTIONS as readonly unknown[]).includes(
		value,
	)
		? (value as LunaCacheKeepaliveMinutes)
		: undefined;
}

export function normalizeV2UserMessageRetention(
	value: unknown,
): V2UserMessageRetention | undefined {
	return value === 16 || value === 32 || value === 64 ? value : undefined;
}

export function normalizeDictationShortcutMode(
	value: unknown,
): DictationShortcutMode | undefined {
	return value === "push" || value === "toggle" ? value : undefined;
}

export function normalizeRealtimeV3Voice(
	value: unknown,
): RealtimeV3Voice | undefined {
	return typeof value === "string"
		? REALTIME_V3_VOICES.find((voice) => voice === value)
		: undefined;
}

export function normalizeProviderList(value: unknown): string[] {
	if (!Array.isArray(value)) return [];
	return [
		...new Set(
			value
				.filter((entry): entry is string => typeof entry === "string")
				.map((entry) => entry.trim().toLowerCase())
				.filter(Boolean),
		),
	];
}

export function normalizeVoiceContextReasoning(
	value: unknown,
): VoiceContextReasoning {
	return typeof value === "string" &&
		(VOICE_CONTEXT_REASONING_LEVELS as readonly string[]).includes(value)
		? (value as VoiceContextReasoning)
		: DEFAULT_VOICE_CONTEXT_REASONING;
}

export function normalizeCustomRustBinariesDir(value: unknown): string {
	return normalizeOptionalString(value) ?? "";
}
