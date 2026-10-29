// Invalid explicit selections stay invalid instead of switching accounts to openai.
export function normalizeVoiceApiProvider(value: unknown): string | undefined {
	return typeof value === "string" &&
		value.trim() === value &&
		value.length > 0 &&
		Buffer.byteLength(value) <= 512 &&
		!/[\u0000-\u001f\u007f]/u.test(value)
		? value
		: undefined;
}

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
function normalizeGippityVoiceModel(
	value: unknown,
): GippityVoiceModel | undefined {
	return GIPPITY_VOICE_MODELS.find((model) => model === value);
}
function normalizeOpenAIRealtimeVoice(
	value: unknown,
): OpenAIRealtimeVoice | undefined {
	return OPENAI_REALTIME_VOICES.find((voice) => voice === value);
}

type DictationShortcutMode = "push" | "toggle";

export const DEFAULT_GIPPITY_LAN_PORT = 43_120;

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
const DEFAULT_VOICE_CONTEXT_REASONING: VoiceContextReasoning = "high";

export interface VoiceContextModel {
	provider: string;
	modelId: string;
}

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

export interface GippityControlConfig {
	lan: {
		customWebApp: boolean;
		customWebAppPath?: string | undefined;
		port?: number | undefined;
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
		contextModel?: VoiceContextModel | undefined;
		contextReasoning: VoiceContextReasoning;
		taskDelegationModel: string;
		taskDelegationReasoning: VoiceContextReasoning;
		inputDevice?: string | undefined;
		outputDevice?: string | undefined;
	};
}

export const DEFAULT_GIPPITY_CONTROL_CONFIG: GippityControlConfig = {
	lan: {
		customWebApp: false,
	},
	voice: {
		model: "codex-live-1.1",
		apiProvider: "openai",
		realtimeVoice: "marin",
		realtimeAlternateVoice: "cedar",
		webSearch: false,
		v3Voice: "cove",
		v3AlternateVoice: "ember",
		autoResumeRealtime: false,
		refreshRealtimeAfterCompaction: false,
		audioSetupCompleted: false,
		delegationAcknowledgements: true,
		forwardReasoningSummaries: true,
		dictationShortcut: "ctrl+alt+d",
		realtimeShortcut: "ctrl+alt+space",
		muteShortcut: "ctrl+alt+m",
		serverShortcut: "ctrl+alt+g",
		dictationShortcutMode: "push",
		contextReasoning: DEFAULT_VOICE_CONTEXT_REASONING,
		taskDelegationModel: "openai-codex/gpt-6-luna",
		taskDelegationReasoning: "low",
	},
};

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
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

function optionalPort(value: unknown): number | undefined {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 65_535
		? value
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
	fallback: VoiceContextReasoning = DEFAULT_VOICE_CONTEXT_REASONING,
): VoiceContextReasoning {
	return typeof value === "string" &&
		(VOICE_CONTEXT_REASONING_LEVELS as readonly string[]).includes(value)
		? (value as VoiceContextReasoning)
		: fallback;
}

export function normalizeRealtimeV3Voice(
	value: unknown,
): RealtimeV3Voice | undefined {
	return typeof value === "string"
		? REALTIME_V3_VOICES.find((voice) => voice === value)
		: undefined;
}

export function normalizeGippityControlConfig(
	value: unknown,
): GippityControlConfig {
	if (!isObject(value)) return structuredClone(DEFAULT_GIPPITY_CONTROL_CONFIG);
	const lan = isObject(value["lan"]) ? value["lan"] : {};
	const voice = isObject(value["voice"]) ? value["voice"] : {};
	const customWebAppPath = optionalString(lan["customWebAppPath"]);
	const port = optionalPort(lan["port"]);
	const inputDevice = optionalString(voice["inputDevice"]);
	const outputDevice = optionalString(voice["outputDevice"]);
	const contextModel = normalizeVoiceContextModel(voice["contextModel"]);
	return {
		lan: {
			customWebApp: lan["customWebApp"] === true,
			...(customWebAppPath ? { customWebAppPath } : {}),
			...(port ? { port } : {}),
		},
		voice: {
			model: normalizeGippityVoiceModel(voice["model"]) ?? "codex-live-1.1",
			apiProvider:
				voice["apiProvider"] === undefined
					? "openai"
					: (normalizeVoiceApiProvider(voice["apiProvider"]) ?? ""),
			realtimeVoice:
				normalizeOpenAIRealtimeVoice(voice["realtimeVoice"]) ?? "marin",
			realtimeAlternateVoice:
				normalizeOpenAIRealtimeVoice(voice["realtimeAlternateVoice"]) ??
				"cedar",
			webSearch: voice["webSearch"] === true,
			v3Voice:
				normalizeRealtimeV3Voice(voice["v3Voice"]) ??
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.v3Voice,
			v3AlternateVoice:
				normalizeRealtimeV3Voice(voice["v3AlternateVoice"]) ??
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.v3AlternateVoice,
			autoResumeRealtime:
				typeof voice["autoResumeRealtime"] === "boolean"
					? voice["autoResumeRealtime"]
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.autoResumeRealtime,
			refreshRealtimeAfterCompaction:
				typeof voice["refreshRealtimeAfterCompaction"] === "boolean"
					? voice["refreshRealtimeAfterCompaction"]
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.refreshRealtimeAfterCompaction,
			audioSetupCompleted:
				typeof voice["audioSetupCompleted"] === "boolean"
					? voice["audioSetupCompleted"]
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.audioSetupCompleted,
			delegationAcknowledgements:
				typeof voice["delegationAcknowledgements"] === "boolean"
					? voice["delegationAcknowledgements"]
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.delegationAcknowledgements,
			forwardReasoningSummaries:
				typeof voice["forwardReasoningSummaries"] === "boolean"
					? voice["forwardReasoningSummaries"]
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.forwardReasoningSummaries,
			dictationShortcut: stringValue(
				voice["dictationShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.dictationShortcut,
			),
			realtimeShortcut: stringValue(
				voice["realtimeShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.realtimeShortcut,
			),
			muteShortcut: stringValue(
				voice["muteShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.muteShortcut,
			),
			serverShortcut: stringValue(
				voice["serverShortcut"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.serverShortcut,
			),
			dictationShortcutMode:
				voice["dictationShortcutMode"] === "toggle"
					? "toggle"
					: DEFAULT_GIPPITY_CONTROL_CONFIG.voice.dictationShortcutMode,
			...(contextModel ? { contextModel } : {}),
			taskDelegationModel: stringValue(
				voice["taskDelegationModel"],
				DEFAULT_GIPPITY_CONTROL_CONFIG.voice.taskDelegationModel,
			),
			taskDelegationReasoning: normalizeVoiceContextReasoning(
				voice["taskDelegationReasoning"],
				"low",
			),
			contextReasoning: normalizeVoiceContextReasoning(
				voice["contextReasoning"],
			),
			...(inputDevice ? { inputDevice } : {}),
			...(outputDevice ? { outputDevice } : {}),
		},
	};
}
