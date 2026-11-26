// Invalid explicit selections stay invalid instead of switching accounts to openai.
export function normalizeVoiceApiProvider(value: unknown): string | undefined {
	return typeof value === "string" &&
		value.trim() === value &&
		value.length > 0 &&
		Buffer.byteLength(value) <= 512 &&
		// oxlint-disable-next-line no-control-regex -- Intentionally matches terminal controls or rejects control characters at the boundary.
		!/[\u0000-\u001f\u007f]/u.test(value)
		? value
		: undefined;
}

export const GIPPITY_VOICE_MODELS = [
	"codex-live-1.1",
	"api-live-1.1",
	"realtime-2.1",
	"realtime-2.1-mini",
] as const;
type GippityVoiceModel = (typeof GIPPITY_VOICE_MODELS)[number];
export const GIPPITY_VOICE_MODEL_OPTIONS = {
	"codex-live-1.1": { label: "Codex Live (OAuth)", kind: "codex" },
	"api-live-1.1": { label: "GPT Live 1.1 (API)", kind: "live" },
	"realtime-2.1": { label: "GPT-Realtime-2.1 (API)", kind: "realtime" },
	"realtime-2.1-mini": {
		label: "GPT-Realtime-2.1 Mini (API)",
		kind: "realtime",
	},
} as const satisfies Record<
	GippityVoiceModel,
	{ label: string; kind: "codex" | "live" | "realtime" }
>;
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

import {
	DEFAULT_EXECUTION_MODE,
	type ExecutionMode,
} from "./execution-mode.ts";
import type { ModelScopeMode, ModelScopeOverrides } from "./model-scope.ts";

export type CodexVerbosity = "low" | "medium" | "high";
export const FAST_MODE_FAMILIES = ["astra", "sol", "terra", "luna"] as const;
export type FastModeFamily = (typeof FAST_MODE_FAMILIES)[number];
export type FastModeConfig = Record<
	FastModeFamily | "other",
	boolean | "ultrafast"
>;
export type CacheDiagnosticsMode = "off" | "status" | "status-and-log";
export type ToolDetailsMode = "minimal" | "compact" | "preview";
export type LunaCacheKeepaliveMinutes = 0 | 5 | 10 | 15;
export type LunaCacheKeepaliveIntervalMinutes = 2.5 | 4.5;
export type CacheKeepaliveIntervalMinutes = 25 | 55;
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
export const DEFAULT_VOICE_CONTEXT_MODEL: VoiceContextModel = {
	provider: "openai-codex",
	modelId: "gpt-6-luna",
};

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
	prompt: {
		heavySystemPromptOverwrite: boolean;
		currentTimeReminderMinutes: 0 | 30 | 60;
	};
	scope: {
		mode: ModelScopeMode;
		modelOverrides: ModelScopeOverrides;
	};
	tools: {
		autoReasoning: boolean;
		customRustBinariesDir: string;
		viewImageFallback: boolean;
	};
	ui: {
		statusLine: boolean;
		toolRenaming: boolean;
		toolDetails: ToolDetailsMode;
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
		maxHeapMiB: number;
		plainCommandOutput: boolean;
		profile?: string | undefined;
	};
	voice: {
		model: GippityVoiceModel;
		apiProvider: string;
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
		contextModel?: VoiceContextModel | "current" | undefined;
		contextReasoning: VoiceContextReasoning;
		taskDelegationModel: string;
		taskDelegationReasoning: VoiceContextReasoning;
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
	};
}

export const DEFAULT_CODEX_CONVERSION_CONFIG: CodexConversionConfig = {
	executionMode: DEFAULT_EXECUTION_MODE,
	prompt: { heavySystemPromptOverwrite: false, currentTimeReminderMinutes: 0 },
	scope: { mode: "automatic", modelOverrides: {} },
	tools: {
		autoReasoning: false,
		customRustBinariesDir: "",
		viewImageFallback: false,
	},
	ui: {
		statusLine: true,
		toolRenaming: true,
		toolDetails: "compact",
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
		plainCommandOutput: true,
	},
	voice: {
		model: "codex-live-1.1",
		apiProvider: "openai",
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
		contextModel: "current",
		contextReasoning: DEFAULT_VOICE_CONTEXT_REASONING,
		taskDelegationModel: "openai-codex/gpt-6-luna",
		taskDelegationReasoning: "low",
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
	},
};
