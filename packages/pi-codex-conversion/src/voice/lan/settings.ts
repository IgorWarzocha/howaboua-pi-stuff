import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { getCodexConversionConfigPath, getProjectCodexConversionConfigPath, hasFolderCodexConversionConfig, readLayeredCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config-store.ts";
import { REALTIME_V3_VOICES, VOICE_CONTEXT_REASONING_LEVELS, normalizeRealtimeV3Voice, normalizeVoiceContextReasoning, type VoiceContextModel, type RealtimeV3Voice, type VoiceContextReasoning } from "../../adapter/activation/config.ts";
import { LanVoiceSettingsError, type LanVoiceSettings } from "./settings-contract.ts";

const BOOLEAN_SETTINGS = ["autoResumeRealtime", "refreshRealtimeAfterCompaction", "delegationAcknowledgements", "forwardReasoningSummaries"] as const;
interface VoiceSettings {
	v3Voice: RealtimeV3Voice;
	contextModel?: VoiceContextModel | undefined;
	contextReasoning: VoiceContextReasoning;
	autoResumeRealtime: boolean;
	refreshRealtimeAfterCompaction: boolean;
	delegationAcknowledgements: boolean;
	forwardReasoningSummaries: boolean;
}

export function createLanVoiceSettings(ctx: ExtensionContext, getConfig: () => CodexConversionConfig): LanVoiceSettings {
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
				v3Voice: voice.v3Voice,
				contextModel: voice.contextModel ?? null,
				contextReasoning: voice.contextReasoning,
				...Object.fromEntries(BOOLEAN_SETTINGS.map((key) => [key, voice[key]])),
			},
			voices: REALTIME_V3_VOICES,
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
				if (key === "v3Voice") {
					const voice = normalizeRealtimeV3Voice(value);
					if (!voice) throw new LanVoiceSettingsError("Choose a listed voice");
					patch.v3Voice = voice;
				} else if (key === "contextReasoning") {
					if (typeof value !== "string" || !(VOICE_CONTEXT_REASONING_LEVELS as readonly string[]).includes(value))
						throw new LanVoiceSettingsError("Choose a listed context reasoning level");
					patch.contextReasoning = normalizeVoiceContextReasoning(value);
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
