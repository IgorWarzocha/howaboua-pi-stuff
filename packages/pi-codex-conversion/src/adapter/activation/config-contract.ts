import type { ExecutionMode } from "./execution-mode.ts";

export type CodexVerbosity = "low" | "medium" | "high";
export type CacheDiagnosticsMode = "off" | "status" | "status-and-log";
export type LunaCacheKeepaliveMinutes = 0 | 5 | 10 | 15;
export type AllProvidersMode = "off" | "on" | "extras";
export type ContextManagementMode = "off" | "local" | "tree" | "remote";
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
	prompt: { heavySystemPromptOverwrite: boolean };
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
		compactTools: boolean;
		codeModeDetails: boolean;
		backgroundShellWidget: boolean;
		backgroundShellToggleShortcut: string;
		backgroundShellPrevShortcut: string;
		backgroundShellNextShortcut: string;
		backgroundShellCloseShortcut: string;
	};
	compaction: {
		contextManagement: ContextManagementMode;
		responsesCompaction: boolean;
		portableSummary: boolean;
		v2UserMessageRetention: V2UserMessageRetention;
	};
	notebook: { maxHeapMiB: number; profile?: string | undefined };
	voice: {
		v3Voice: RealtimeV3Voice;
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
		fast: boolean;
		verbosity: CodexVerbosity;
		lunaCacheKeepaliveMinutes: LunaCacheKeepaliveMinutes;
		cacheKeepalive: boolean;
		proxyResponsesLite: boolean;
		forceCachedWebSockets: boolean;
		cacheDiagnostics: CacheDiagnosticsMode;
		harnessIdentifierHeader: boolean;
	};
}

export const DEFAULT_CODEX_CONVERSION_CONFIG: CodexConversionConfig = {
	executionMode: "normal",
	voiceFeaturesOnly: false,
	prompt: { heavySystemPromptOverwrite: false },
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
		compactTools: false,
		codeModeDetails: false,
		backgroundShellWidget: true,
		backgroundShellToggleShortcut: "alt+w",
		backgroundShellPrevShortcut: "alt+q",
		backgroundShellNextShortcut: "alt+e",
		backgroundShellCloseShortcut: "alt+r",
	},
	compaction: {
		contextManagement: "off",
		responsesCompaction: false,
		portableSummary: false,
		v2UserMessageRetention: 64,
	},
	notebook: { maxHeapMiB: 4_096 },
	voice: {
		v3Voice: "cove",
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
			modelId: "gpt-5.6-luna",
		},
		contextReasoning: DEFAULT_VOICE_CONTEXT_REASONING,
	},
	openai: {
		fast: false,
		verbosity: "low",
		lunaCacheKeepaliveMinutes: 0,
		cacheKeepalive: false,
		proxyResponsesLite: false,
		forceCachedWebSockets: true,
		cacheDiagnostics: "off",
		harnessIdentifierHeader: false,
	},
};
