export const GIPPITY_VOICE_MODELS = [
	"codex-live-1.1",
	"realtime-2.1",
	"realtime-2.1-mini",
] as const;
type GippityVoiceModel = (typeof GIPPITY_VOICE_MODELS)[number];
export const OPENAI_REALTIME_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"coral",
	"echo",
	"sage",
	"shimmer",
	"verse",
	"marin",
	"cedar",
] as const;
type OpenAIRealtimeVoice = (typeof OPENAI_REALTIME_VOICES)[number];
export function normalizeGippityVoiceModel(
	value: unknown,
): GippityVoiceModel | undefined {
	return GIPPITY_VOICE_MODELS.find((model) => model === value);
}
export function normalizeOpenAIRealtimeVoice(
	value: unknown,
): OpenAIRealtimeVoice | undefined {
	return OPENAI_REALTIME_VOICES.find((voice) => voice === value);
}

import type { ExecutionMode } from "./execution-mode.ts";

export type CodexVerbosity = "low" | "medium" | "high";
export type HeavySystemPromptOverwrite = boolean | "gpt";
export const FAST_MODE_FAMILIES = ["astra", "sol", "terra", "luna"] as const;
export type FastModeFamily = (typeof FAST_MODE_FAMILIES)[number];
export type FastModeConfig = Record<
	FastModeFamily | "other",
	boolean | "ultrafast"
>;
export type CacheDiagnosticsMode = "off" | "status" | "status-and-log";
export type CompactToolsMode = "off" | "on" | "minimal";
export type LunaCacheKeepaliveMinutes = 0 | 5 | 10 | 15;
export type LunaCacheKeepaliveIntervalMinutes = 2.5 | 4.5;
export type CacheKeepaliveIntervalMinutes = 25 | 55;
export type AllProvidersMode = "off" | "on" | "extras";
export type CompactionMethod = "pi" | "v2" | "both";
export type V2UserMessageRetention = 16 | 32 | 64;
export const MIN_NOTEBOOK_HEAP_MIB = 256;
export const MAX_NOTEBOOK_HEAP_MIB = 65_536;
export type DictationShortcutMode = "push" | "toggle";
export const VOICE_CONTEXT_REASONING_LEVELS = [
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
] as const;
export type VoiceContextReasoning =
	(typeof VOICE_CONTEXT_REASONING_LEVELS)[number];
export const DEFAULT_VOICE_CONTEXT_REASONING: VoiceContextReasoning = "high";
export type VoiceContextModel = { provider: string; modelId: string };

export const REALTIME_V3_VOICES = [
	"juniper",
	"maple",
	"spruce",
	"ember",
	"vale",
	"breeze",
	"arbor",
	"sol",
	"cove",
] as const;
export type RealtimeV3Voice = (typeof REALTIME_V3_VOICES)[number];

export const V2_USER_MESSAGE_RETENTION_OPTIONS: readonly V2UserMessageRetention[] =
	[16, 32, 64];
export const LUNA_CACHE_KEEPALIVE_MINUTES_OPTIONS: readonly LunaCacheKeepaliveMinutes[] =
	[0, 5, 10, 15];

export interface CodexConversionConfig {
	executionMode: ExecutionMode;
	voiceFeaturesOnly: boolean;
	prompt: {
		heavySystemPromptOverwrite: HeavySystemPromptOverwrite;
		currentTimeReminderMinutes: 0 | 30 | 60;
	};
	scope: { allProviders: AllProvidersMode; additionalProviders: string[] };
	tools: {
		autoReasoning: boolean;
		customRustBinariesDir: string;
		viewImageFallback: boolean;
		applyPatchOnly: boolean;
		viewImageOnly: boolean;
	};
	ui: {
		statusLine: boolean;
		toolRenaming: boolean;
		compactTools: CompactToolsMode;
		codeModeDetails: boolean;
		backgroundShellWidget: boolean;
		backgroundShellToggleShortcut: string;
		backgroundShellPrevShortcut: string;
		backgroundShellNextShortcut: string;
		backgroundShellCloseShortcut: string;
	};
	compaction: {
		method: CompactionMethod;
		v2UserMessageRetention: V2UserMessageRetention;
	};
	notebook: {
		journals: "off" | "week" | "on";
		checkpointCleanup: "never" | "month" | "week";
		maxHeapMiB: number;
		plainCommandOutput: boolean;
		profile?: string | undefined;
	};
	voice: {
		model: GippityVoiceModel;
		realtimeVoice: OpenAIRealtimeVoice;
		realtimeAlternateVoice: OpenAIRealtimeVoice;
		webSearch: boolean;
		v3Voice: RealtimeV3Voice;
		v3AlternateVoice: RealtimeV3Voice;
		autoResumeRealtime: boolean;
		refreshRealtimeAfterCompaction: boolean;
		audioSetupCompleted: boolean;
		delegationAcknowledgements: boolean;
		forwardReasoningSummaries: boolean;
		dictationShortcut: string;
		realtimeShortcut: string;
		muteShortcut: string;
		serverShortcut: string;
		dictationShortcutMode: DictationShortcutMode;
		contextModel?: VoiceContextModel | undefined;
		contextReasoning: VoiceContextReasoning;
		inputDevice?: string | undefined;
		outputDevice?: string | undefined;
	};
	openai: {
		fast: FastModeConfig;
		daybreak: boolean;
		verbosity: CodexVerbosity;
		lunaCacheKeepaliveMinutes: LunaCacheKeepaliveMinutes;
		lunaCacheKeepaliveIntervalMinutes: LunaCacheKeepaliveIntervalMinutes;
		cacheKeepalive: boolean;
		cacheKeepaliveIntervalMinutes: CacheKeepaliveIntervalMinutes;
		proxyResponsesLite: boolean;
		cacheDiagnostics: CacheDiagnosticsMode;
		harnessIdentifierHeader: boolean | "codex";
	};
}

export const DEFAULT_CODEX_CONVERSION_CONFIG: CodexConversionConfig = {
	executionMode: "normal",
	voiceFeaturesOnly: false,
	prompt: { heavySystemPromptOverwrite: false, currentTimeReminderMinutes: 0 },
	scope: { allProviders: "off", additionalProviders: [] },
	tools: {
		autoReasoning: false,
		customRustBinariesDir: "",
		viewImageFallback: false,
		applyPatchOnly: false,
		viewImageOnly: false,
	},
	ui: {
		statusLine: true,
		toolRenaming: true,
		compactTools: "off",
		codeModeDetails: false,
		backgroundShellWidget: true,
		backgroundShellToggleShortcut: "alt+w",
		backgroundShellPrevShortcut: "alt+q",
		backgroundShellNextShortcut: "alt+e",
		backgroundShellCloseShortcut: "alt+r",
	},
	compaction: {
		method: "pi",
		v2UserMessageRetention: 64,
	},
	notebook: {
		maxHeapMiB: 4_096,
		plainCommandOutput: false,
		journals: "week",
		checkpointCleanup: "never",
	},
	voice: {
		model: "codex-live-1.1",
		realtimeVoice: "marin",
		realtimeAlternateVoice: "cedar",
		webSearch: false,
		v3Voice: "cove",
		v3AlternateVoice: "ember",
		autoResumeRealtime: true,
		refreshRealtimeAfterCompaction: true,
		audioSetupCompleted: false,
		delegationAcknowledgements: true,
		forwardReasoningSummaries: true,
		dictationShortcut: "ctrl+alt+d",
		realtimeShortcut: "ctrl+alt+space",
		muteShortcut: "ctrl+alt+m",
		serverShortcut: "ctrl+alt+g",
		dictationShortcutMode: "push",
		contextModel: {
			provider: "openai-codex",
			modelId: "gpt-6-luna",
		},
		contextReasoning: DEFAULT_VOICE_CONTEXT_REASONING,
	},
	openai: {
		fast: { astra: false, sol: false, terra: false, luna: false, other: false },
		daybreak: false,
		verbosity: "low",
		lunaCacheKeepaliveMinutes: 0,
		lunaCacheKeepaliveIntervalMinutes: 2.5,
		cacheKeepalive: false,
		cacheKeepaliveIntervalMinutes: 25,
		proxyResponsesLite: false,
		cacheDiagnostics: "off",
		harnessIdentifierHeader: false,
	},
};
