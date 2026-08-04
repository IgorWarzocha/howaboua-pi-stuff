import {
	type CodexConversionConfig,
	normalizeRealtimeV3Voice,
	normalizeVoiceContextReasoning,
	REALTIME_V3_VOICES,
	VOICE_CONTEXT_REASONING_LEVELS,
	type VoiceContextModel,
} from "../../adapter/activation/config.ts";
import { type ConfigSetting, setting } from "./config-items-shared.ts";

export function buildVoiceSettings(
	config: CodexConversionConfig,
	availableContextModels: VoiceContextModel[],
): ConfigSetting[] {
	const contextModels = new Map(
		availableContextModels.map((model) => [formatContextModel(model), model]),
	);
	const currentContextModel = config.voice.contextModel
		? formatContextModel(config.voice.contextModel)
		: "off";
	const currentContextReasoning = config.voice.contextReasoning;
	return [
		setting(
			{
				id: "v3Voice",
				label: "Codex voice",
				currentValue: formatVoiceName(config.voice.v3Voice),
				values: REALTIME_V3_VOICES.map(formatVoiceName),
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					v3Voice:
						normalizeRealtimeV3Voice(value.toLowerCase()) ??
						current.voice.v3Voice,
				},
			}),
		),
		setting(
			{
				id: "voiceContextModel",
				label: "Voice context model",
				currentValue: currentContextModel,
				values: [
					"off",
					...new Set([
						...(config.voice.contextModel ? [currentContextModel] : []),
						...[...contextModels.keys()].sort(),
					]),
				],
			},
			(value, current) => {
				const { contextModel: _contextModel, ...voice } = current.voice;
				const selected = contextModels.get(value);
				return {
					...current,
					voice:
						value === "off"
							? voice
							: {
									...voice,
									contextModel: selected ?? current.voice.contextModel,
								},
				};
			},
		),
		setting(
			{
				id: "voiceContextReasoning",
				label: "Voice context reasoning",
				currentValue: currentContextReasoning,
				values: [...VOICE_CONTEXT_REASONING_LEVELS],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					contextReasoning: normalizeVoiceContextReasoning(value),
				},
			}),
		),
		setting(
			{
				id: "dictationShortcutMode",
				label: "Dictation key behavior",
				currentValue:
					config.voice.dictationShortcutMode === "push"
						? "push to dictate"
						: "toggle",
				values: ["push to dictate", "toggle"],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					dictationShortcutMode: value === "toggle" ? "toggle" : "push",
				},
			}),
		),
	];
}

function formatVoiceName(voice: string): string {
	return `${voice.slice(0, 1).toUpperCase()}${voice.slice(1)}`;
}

function formatContextModel(model: VoiceContextModel): string {
	return `${model.provider}/${model.modelId}`;
}
