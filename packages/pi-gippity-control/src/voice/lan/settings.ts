import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../../config.ts";
import {
	GIPPITY_VOICE_MODELS,
	normalizeRealtimeV3Voice,
	normalizeVoiceApiProvider,
	normalizeVoiceContextReasoning,
	OPENAI_REALTIME_VOICES,
	REALTIME_V3_VOICES,
	type RealtimeV3Voice,
	VOICE_CONTEXT_REASONING_LEVELS,
	type VoiceContextModel,
	type VoiceContextReasoning,
} from "../../config.ts";
import {
	getGippityControlConfigPath,
	readGippityControlConfig,
	writeGippityControlConfig,
} from "../../config-store.ts";

const BOOLEAN_SETTINGS = [
	"webSearch",
	"autoResumeRealtime",
	"refreshRealtimeAfterCompaction",
	"delegationAcknowledgements",
	"forwardReasoningSummaries",
] as const;
interface VoiceSettings {
	apiProvider: string;
	model: GippityControlConfig["voice"]["model"];
	realtimeVoice: GippityControlConfig["voice"]["realtimeVoice"];
	realtimeAlternateVoice: GippityControlConfig["voice"]["realtimeAlternateVoice"];
	webSearch: boolean;
	v3Voice: RealtimeV3Voice;
	v3AlternateVoice: RealtimeV3Voice;
	contextModel?: VoiceContextModel | undefined;
	contextReasoning: VoiceContextReasoning;
	taskDelegationReasoning: VoiceContextReasoning;
	autoResumeRealtime: boolean;
	refreshRealtimeAfterCompaction: boolean;
	delegationAcknowledgements: boolean;
	forwardReasoningSummaries: boolean;
}

export class LanVoiceSettingsError extends Error {}

export function createLanVoiceSettings(
	ctx: ExtensionContext,
	getConfig: () => GippityControlConfig,
	hasWebSearch?: () => boolean,
) {
	const readConfig = () => readGippityControlConfig();
	const scope = () => "Global";
	const saveVoice = (patch: Partial<VoiceSettings>) => {
		const current = readConfig();
		const result = writeGippityControlConfig(
			{ ...current, voice: { ...current.voice, ...patch } },
			getGippityControlConfigPath(),
		);
		if (!result.ok)
			throw new Error(
				"Could not save voice settings; check the config file permissions and retry",
			);
	};
	const models = () =>
		ctx.modelRegistry
			.getAvailable()
			.filter((model) => model.input.includes("text"))
			.map((model) => ({ provider: model.provider, modelId: model.id }));
	const snapshot = () => {
		const voice = readConfig().voice;
		return {
			config: {
				model: voice.model,
				apiProvider: voice.apiProvider,
				realtimeVoice: voice.realtimeVoice,
				realtimeAlternateVoice: voice.realtimeAlternateVoice,
				v3Voice: voice.v3Voice,
				v3AlternateVoice: voice.v3AlternateVoice,
				contextModel: voice.contextModel ?? null,
				contextReasoning: voice.contextReasoning,
				taskDelegationModel: voice.taskDelegationModel,
				taskDelegationReasoning: voice.taskDelegationReasoning,
				...Object.fromEntries(BOOLEAN_SETTINGS.map((key) => [key, voice[key]])),
			},
			voices: REALTIME_V3_VOICES,
			voiceModels: GIPPITY_VOICE_MODELS,
			webSearchAvailable: hasWebSearch?.() ?? null,
			realtimeVoices: OPENAI_REALTIME_VOICES,
			contextModels: models(),
			contextReasoningLevels: VOICE_CONTEXT_REASONING_LEVELS,
			scope: scope(),
		};
	};
	return {
		getConfig: () => ({ ...getConfig(), voice: readConfig().voice }),
		settings: snapshot,
		configureSettings(body: Record<string, unknown>) {
			const patch: Partial<VoiceSettings> = {};
			for (const [key, value] of Object.entries(body)) {
				if (key === "clientId") continue;
				if (key === "apiProvider") {
					const provider = normalizeVoiceApiProvider(value);
					if (!provider)
						throw new LanVoiceSettingsError(
							"Enter a nonempty API provider name, at most 512 bytes, without surrounding whitespace or control characters",
						);
					patch.apiProvider = provider;
				} else if (key === "model") {
					const model = GIPPITY_VOICE_MODELS.find((entry) => entry === value);
					if (!model)
						throw new LanVoiceSettingsError("Choose a listed voice model");
					patch.model = model;
				} else if (
					key === "realtimeVoice" ||
					key === "realtimeAlternateVoice"
				) {
					const voice = OPENAI_REALTIME_VOICES.find((entry) => entry === value);
					if (!voice)
						throw new LanVoiceSettingsError("Choose a listed Realtime voice");
					patch[key] = voice;
				} else if (key === "v3Voice" || key === "v3AlternateVoice") {
					const voice = normalizeRealtimeV3Voice(value);
					if (!voice) throw new LanVoiceSettingsError("Choose a listed voice");
					patch[key] = voice;
				} else if (
					key === "contextReasoning" ||
					key === "taskDelegationReasoning"
				) {
					if (
						typeof value !== "string" ||
						!(VOICE_CONTEXT_REASONING_LEVELS as readonly string[]).includes(
							value,
						)
					)
						throw new LanVoiceSettingsError("Choose a listed reasoning level");
					patch[key] = normalizeVoiceContextReasoning(value);
				} else if (key === "contextModel") {
					if (value === null) patch.contextModel = undefined;
					else {
						if (!value || typeof value !== "object" || Array.isArray(value))
							throw new LanVoiceSettingsError(
								"Choose a listed context model or Off",
							);
						const model = value as Record<string, unknown>;
						if (
							Object.keys(model).some(
								(field) => field !== "provider" && field !== "modelId",
							)
						)
							throw new LanVoiceSettingsError("Invalid context model");
						const current = readConfig().voice.contextModel;
						const selected = [...models(), ...(current ? [current] : [])].find(
							(entry) =>
								entry.provider === model["provider"] &&
								entry.modelId === model["modelId"],
						);
						if (!selected)
							throw new LanVoiceSettingsError(
								"Choose an available context model",
							);
						patch.contextModel = selected;
					}
				} else {
					const booleanKey = BOOLEAN_SETTINGS.find((field) => field === key);
					if (!booleanKey)
						throw new LanVoiceSettingsError("Unknown voice setting");
					if (typeof value !== "boolean")
						throw new LanVoiceSettingsError(
							"Voice switches must be true or false",
						);
					patch[booleanKey] = value;
				}
			}
			saveVoice(patch);
			return snapshot();
		},
	};
}
