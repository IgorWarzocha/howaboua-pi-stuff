import { normalizeVoiceApiProvider } from "../../adapter/activation/config.ts";
import { GIPPITY_VOICE_MODELS, OPENAI_REALTIME_VOICES } from "../../adapter/activation/config.ts";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { getCodexConversionConfigPath, getProjectCodexConversionConfigPath, hasFolderCodexConversionConfig, readLayeredCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config-store.ts";
import { REALTIME_V3_VOICES, VOICE_CONTEXT_REASONING_LEVELS, normalizeRealtimeV3Voice, normalizeVoiceContextReasoning, type VoiceContextModel, type RealtimeV3Voice, type VoiceContextReasoning } from "../../adapter/activation/config.ts";
import { LanVoiceSettingsError, type LanVoiceSettings } from "./settings-contract.ts";

const BOOLEAN_SETTINGS = ["webSearch", "autoResumeRealtime", "refreshRealtimeAfterCompaction", "delegationAcknowledgements", "forwardReasoningSummaries"] as const;
interface VoiceSettings {
	apiProvider: string;
	model: CodexConversionConfig["voice"]["model"];
	realtimeVoice: CodexConversionConfig["voice"]["realtimeVoice"];
	realtimeAlternateVoice: CodexConversionConfig["voice"]["realtimeAlternateVoice"];
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

export function createLanVoiceSettings(ctx: ExtensionContext, getConfig: () => CodexConversionConfig, hasWebSearch?: () => boolean): LanVoiceSettings {
	const folderScope = () => hasFolderCodexConversionConfig(ctx.cwd, ctx.isProjectTrusted());
	const readConfig = () => readLayeredCodexConversionConfig({ cwd: ctx.cwd, projectTrusted: ctx.isProjectTrusted() });
	const scope = () => folderScope() ? "This project" : "Global";
	const saveVoice = (patch: Partial<VoiceSettings>) => {
		const current = readConfig();
		const folder = folderScope();
		const result = writeCodexConversionConfig({ ...current, voice: { ...current.voice, ...patch } },
			folder ? getProjectCodexConversionConfigPath(ctx.cwd) : getCodexConversionConfigPath(), folder);
		if (!result.ok) throw new Error("Could not save voice settings; check the config file permissions and retry");
	};
	const models = () => ctx.modelRegistry.getAvailable()
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
					if (!provider) throw new LanVoiceSettingsError("Enter a nonempty API provider name, at most 512 bytes, without surrounding whitespace or control characters");
					patch.apiProvider = provider;
				} else if (key === "model") {
					const model = GIPPITY_VOICE_MODELS.find((entry) => entry === value);
					if (!model) throw new LanVoiceSettingsError("Choose a listed voice model");
					patch.model = model;
				} else if (key === "realtimeVoice" || key === "realtimeAlternateVoice") {
					const voice = OPENAI_REALTIME_VOICES.find((entry) => entry === value);
					if (!voice) throw new LanVoiceSettingsError("Choose a listed Realtime voice");
					patch[key] = voice;
				} else if (key === "v3Voice" || key === "v3AlternateVoice") {
					const voice = normalizeRealtimeV3Voice(value);
					if (!voice) throw new LanVoiceSettingsError("Choose a listed voice");
					patch[key] = voice;
				} else if (key === "contextReasoning" || key === "taskDelegationReasoning") {
					if (typeof value !== "string" || !(VOICE_CONTEXT_REASONING_LEVELS as readonly string[]).includes(value))
						throw new LanVoiceSettingsError("Choose a listed reasoning level");
					patch[key] = normalizeVoiceContextReasoning(value);
				} else if (key === "contextModel") {
					if (value === null) patch.contextModel = undefined;
					else {
						if (!value || typeof value !== "object" || Array.isArray(value))
							throw new LanVoiceSettingsError("Choose a listed context model or Off");
						const model = value as Record<string, unknown>;
						if (Object.keys(model).some((field) => field !== "provider" && field !== "modelId"))
							throw new LanVoiceSettingsError("Invalid context model");
						const current = readConfig().voice.contextModel;
						const selected = [...models(), ...(current ? [current] : [])]
							.find((entry) => entry.provider === model["provider"] && entry.modelId === model["modelId"]);
						if (!selected) throw new LanVoiceSettingsError("Choose an available context model");
						patch.contextModel = selected;
					}
				} else {
					const booleanKey = BOOLEAN_SETTINGS.find((field) => field === key);
					if (!booleanKey) throw new LanVoiceSettingsError("Unknown voice setting");
					if (typeof value !== "boolean") throw new LanVoiceSettingsError("Voice switches must be true or false");
					patch[booleanKey] = value;
				}
			}
			saveVoice(patch);
			return snapshot();
		},
	};
}
