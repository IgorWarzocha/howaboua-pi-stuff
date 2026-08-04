export type CodexVerbosity = "low" | "medium" | "high";
export type AllProvidersMode = "off" | "on" | "extras";
export type HelperModel =
	| "gpt-5.6-luna"
	| "gpt-5.6-terra"
	| "gpt-5.6-sol"
	| "gpt-5.5"
	| "gpt-5.4-mini"
	| "gpt-5.3-codex-spark";
export type WebSearchModel = HelperModel;
export type V2UserMessageRetention = 16 | 32 | 64;
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

export const HELPER_MODELS: readonly HelperModel[] = [
	"gpt-5.6-luna",
	"gpt-5.6-terra",
	"gpt-5.6-sol",
	"gpt-5.5",
	"gpt-5.4-mini",
	"gpt-5.3-codex-spark",
];
export const WEB_SEARCH_MODELS: readonly WebSearchModel[] = HELPER_MODELS;
export const V2_USER_MESSAGE_RETENTION_OPTIONS: readonly V2UserMessageRetention[] =
	[16, 32, 64];

export interface CodexConversionConfig {
	voiceFeaturesOnly: boolean;
	prompt: { heavySystemPromptOverwrite: boolean };
	scope: { allProviders: AllProvidersMode; additionalProviders: string[] };
	tools: {
		customRustBinariesDir: string;
		webRun: boolean;
		imageGeneration: boolean;
		viewImageFallback: boolean;
		applyPatchOnly: boolean;
		viewImageOnly: boolean;
		webRunOnly: boolean;
		imageGenerationOnly: boolean;
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
	compaction: { responsesCompaction: boolean };
	beta: {
		codeMode: boolean;
		responsesLite: boolean;
		v2UserMessageRetention?: V2UserMessageRetention | undefined;
	};
	voice: {
		v3Voice: RealtimeV3Voice;
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
		forceCachedWebSockets: boolean;
		harnessIdentifierHeader: boolean;
		webSearchModel: WebSearchModel;
	};
}

export const DEFAULT_CODEX_CONVERSION_CONFIG: CodexConversionConfig = {
	voiceFeaturesOnly: false,
	prompt: { heavySystemPromptOverwrite: false },
	scope: { allProviders: "off", additionalProviders: [] },
	tools: {
		customRustBinariesDir: "",
		webRun: true,
		imageGeneration: true,
		viewImageFallback: false,
		applyPatchOnly: false,
		viewImageOnly: false,
		webRunOnly: false,
		imageGenerationOnly: false,
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
	compaction: { responsesCompaction: false },
	beta: { codeMode: false, responsesLite: false, v2UserMessageRetention: 64 },
	voice: {
		v3Voice: "cove",
		dictationShortcut: "ctrl+alt+d",
		realtimeShortcut: "ctrl+alt+space",
		muteShortcut: "ctrl+alt+m",
		serverShortcut: "ctrl+alt+g",
		dictationShortcutMode: "push",
		contextReasoning: DEFAULT_VOICE_CONTEXT_REASONING,
	},
	openai: {
		fast: false,
		verbosity: "low",
		forceCachedWebSockets: true,
		harnessIdentifierHeader: false,
		webSearchModel: "gpt-5.6-luna",
	},
};

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeAllProvidersMode(
	value: unknown,
): AllProvidersMode | undefined {
	if (value === true) return "on";
	if (value === false) return "off";
	return value === "off" || value === "on" || value === "extras"
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

export function normalizeWebSearchModel(
	value: unknown,
): WebSearchModel | undefined {
	if (typeof value !== "string") return undefined;
	return (WEB_SEARCH_MODELS as readonly string[]).includes(value)
		? (value as WebSearchModel)
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

function bool(value: unknown, fallback: boolean): boolean {
	return typeof value === "boolean" ? value : fallback;
}

function stringValue(value: unknown, fallback: string): string {
	return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function optionalString(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim();
	return normalized && Buffer.byteLength(normalized) <= 512
		? normalized
		: undefined;
}

function normalizeVoiceContextModel(
	value: unknown,
): VoiceContextModel | undefined {
	if (!isObject(value)) return undefined;
	const provider = optionalString(value["provider"]);
	const modelId = optionalString(value["modelId"]);
	return provider && modelId ? { provider, modelId } : undefined;
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
	return optionalString(value) ?? "";
}

export function normalizeCodexConversionConfig(
	value: unknown,
): CodexConversionConfig {
	if (!isObject(value)) return structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const prompt = isObject(value["prompt"]) ? value["prompt"] : {};
	const scope = isObject(value["scope"]) ? value["scope"] : {};
	const tools = isObject(value["tools"]) ? value["tools"] : {};
	const ui = isObject(value["ui"]) ? value["ui"] : {};
	const compaction = isObject(value["compaction"]) ? value["compaction"] : {};
	const beta = isObject(value["beta"]) ? value["beta"] : {};
	const voice = isObject(value["voice"]) ? value["voice"] : {};
	const openai = isObject(value["openai"]) ? value["openai"] : {};
	const inputDevice = optionalString(voice["inputDevice"]);
	const outputDevice = optionalString(voice["outputDevice"]);
	const contextModel = normalizeVoiceContextModel(voice["contextModel"]);
	return {
		voiceFeaturesOnly: bool(
			value["voiceFeaturesOnly"],
			DEFAULT_CODEX_CONVERSION_CONFIG.voiceFeaturesOnly,
		),
		prompt: {
			heavySystemPromptOverwrite: bool(
				prompt["heavySystemPromptOverwrite"],
				DEFAULT_CODEX_CONVERSION_CONFIG.prompt.heavySystemPromptOverwrite,
			),
		},
		scope: {
			allProviders:
				normalizeAllProvidersMode(scope["allProviders"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.scope["allProviders"],
			additionalProviders: normalizeProviderList(scope["additionalProviders"]),
		},
		tools: {
			customRustBinariesDir: normalizeCustomRustBinariesDir(
				tools["customRustBinariesDir"],
			),
			webRun: bool(
				tools["webRun"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRun"],
			),
			imageGeneration: bool(
				tools["imageGeneration"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGeneration"],
			),
			viewImageFallback: bool(
				tools["viewImageFallback"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageFallback"],
			),
			applyPatchOnly: bool(
				tools["applyPatchOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["applyPatchOnly"],
			),
			viewImageOnly: bool(
				tools["viewImageOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["viewImageOnly"],
			),
			webRunOnly: bool(
				tools["webRunOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["webRunOnly"],
			),
			imageGenerationOnly: bool(
				tools["imageGenerationOnly"],
				DEFAULT_CODEX_CONVERSION_CONFIG.tools["imageGenerationOnly"],
			),
		},
		ui: {
			statusLine: bool(
				ui["statusLine"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["statusLine"],
			),
			toolRenaming: bool(
				ui["toolRenaming"],
				bool(
					ui["toolRendering"],
					DEFAULT_CODEX_CONVERSION_CONFIG.ui["toolRenaming"],
				),
			),
			compactTools: bool(
				ui["compactTools"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["compactTools"],
			),
			codeModeDetails: bool(
				ui["codeModeDetails"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["codeModeDetails"],
			),
			backgroundShellWidget: bool(
				ui["backgroundShellWidget"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellWidget"],
			),
			backgroundShellToggleShortcut: stringValue(
				ui["backgroundShellToggleShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellToggleShortcut"],
			),
			backgroundShellPrevShortcut: stringValue(
				ui["backgroundShellPrevShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellPrevShortcut"],
			),
			backgroundShellNextShortcut: stringValue(
				ui["backgroundShellNextShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellNextShortcut"],
			),
			backgroundShellCloseShortcut: stringValue(
				ui["backgroundShellCloseShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.ui["backgroundShellCloseShortcut"],
			),
		},
		compaction: {
			responsesCompaction: bool(
				compaction["responsesCompaction"],
				DEFAULT_CODEX_CONVERSION_CONFIG.compaction["responsesCompaction"],
			),
		},
		beta: {
			codeMode: bool(
				beta["codeMode"],
				DEFAULT_CODEX_CONVERSION_CONFIG.beta["codeMode"],
			),
			responsesLite: bool(
				beta["responsesLite"],
				DEFAULT_CODEX_CONVERSION_CONFIG.beta["responsesLite"],
			),
			v2UserMessageRetention:
				normalizeV2UserMessageRetention(beta["v2UserMessageRetention"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.beta.v2UserMessageRetention,
		},
		voice: {
			v3Voice:
				normalizeRealtimeV3Voice(voice["v3Voice"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.v3Voice,
			dictationShortcut: stringValue(
				voice["dictationShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcut,
			),
			realtimeShortcut: stringValue(
				voice["realtimeShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.realtimeShortcut,
			),
			muteShortcut: stringValue(
				voice["muteShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.muteShortcut,
			),
			serverShortcut: stringValue(
				voice["serverShortcut"],
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.serverShortcut,
			),
			dictationShortcutMode:
				normalizeDictationShortcutMode(voice["dictationShortcutMode"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcutMode,
			...(contextModel ? { contextModel } : {}),
			contextReasoning: normalizeVoiceContextReasoning(
				voice["contextReasoning"],
			),
			...(inputDevice ? { inputDevice } : {}),
			...(outputDevice ? { outputDevice } : {}),
		},
		openai: {
			fast: bool(
				openai["fast"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["fast"],
			),
			verbosity:
				normalizeCodexVerbosity(openai["verbosity"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["verbosity"],
			forceCachedWebSockets: bool(
				openai["forceCachedWebSockets"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["forceCachedWebSockets"],
			),
			harnessIdentifierHeader: bool(
				openai["harnessIdentifierHeader"],
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["harnessIdentifierHeader"],
			),
			webSearchModel:
				normalizeWebSearchModel(openai["webSearchModel"]) ??
				DEFAULT_CODEX_CONVERSION_CONFIG.openai["webSearchModel"],
		},
	};
}
