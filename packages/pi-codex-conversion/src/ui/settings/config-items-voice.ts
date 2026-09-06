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
				description: "Choose the speaking voice for Codex realtime conversations.",
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
				id: "autoResumeRealtime",
				description: "Reconnect automatically if an active realtime voice call drops.",
				label: "Auto-resume realtime voice",
				currentValue: config.voice.autoResumeRealtime ? "on" : "off",
				values: ["off", "on"],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					autoResumeRealtime: value === "on",
				},
			}),
		),
		setting(
			{
				id: "delegationAcknowledgements",
				description: "Let the voice model speak a brief acknowledgement when handing a task to the coding agent.",
				label: "Speak delegation acknowledgements",
				currentValue: config.voice.delegationAcknowledgements ? "on" : "off",
				values: ["off", "on"],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					delegationAcknowledgements: value === "on",
				},
			}),
		),
		setting(
			{
				id: "forwardReasoningSummaries",
				description: "Let voice relay reasoning summaries as progress when the coding agent has no spoken text update.",
				label: "Speak reasoning summaries",
				currentValue: config.voice.forwardReasoningSummaries ? "on" : "off",
				values: ["off", "on"],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					forwardReasoningSummaries: value === "on",
				},
			}),
		),
		setting(
			{
				id: "dictationShortcutMode",
				description: "Hold the shortcut to record and release to finish, or press once to start and again to stop.",
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
		setting(
			{
				id: "voiceContextModel",
				description: "Choose a model to summarize the coding session for voice startup. Off starts voice without that summary.",
				label: "Context summarisation model",
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
							? { ...voice, refreshRealtimeAfterCompaction: false }
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
				description: "Set reasoning effort for the voice context summary, where the selected model supports it.",
				label: "Context summarisation reasoning",
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
				id: "refreshRealtimeAfterCompaction",
				description: "Summarize and start a fresh voice call at each context rollover or compaction. Requires a summarization model.",
				label: "Refresh voice context",
				currentValue: config.voice.refreshRealtimeAfterCompaction
					? "on"
					: "off",
				values: ["off", "on"],
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					refreshRealtimeAfterCompaction: value === "on",
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
