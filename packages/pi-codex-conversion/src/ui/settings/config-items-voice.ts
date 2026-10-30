import {
	type CodexConversionConfig,
	GIPPITY_VOICE_MODELS,
	OPENAI_REALTIME_VOICES,
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
	webSearchAvailable?: boolean,
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
				id: "voiceModel",
				label: "Voice model",
				description:
					"Codex Live uses your Codex login. GPT-Realtime requires an OpenAI API key, billed separately. Applies on the next call without restarting the current call.",
				currentValue: formatVoiceModel(config.voice.model),
				values: GIPPITY_VOICE_MODELS.map(formatVoiceModel),
			},
			(value, current) => ({
				...current,
				voice: {
					...current.voice,
					model:
						GIPPITY_VOICE_MODELS.find(
							(model) => formatVoiceModel(model) === value,
						) ?? current.voice.model,
				},
			}),
		),
		...(config.voice.model !== "codex-live-1.1" ? [setting({
			id: "apiProvider", label: "API provider",
			description: "Exact Pi provider name. Uses its API key and endpoint on the next Realtime call. Default: openai.",
			currentValue: config.voice.apiProvider,
		}, (value, current) => ({ ...current, voice: { ...current.voice, apiProvider: value } }))] : []),
		...(config.voice.model === "codex-live-1.1"
			? [
					setting({
						id: "taskDelegationModel",
						label: "Task delegation model",
						description: "",
						currentValue: config.voice.taskDelegationModel,
					}),
					setting({
						id: "taskDelegationReasoning",
						label: "Task delegation reasoning",
						description: "",
						currentValue: config.voice.taskDelegationReasoning,
						values: [...VOICE_CONTEXT_REASONING_LEVELS],
					}, (value, current) => ({
						...current,
						voice: {
							...current.voice,
							taskDelegationReasoning: normalizeVoiceContextReasoning(value),
						},
					})),
				]
			: []),
		...(["primary", "alternate"] as const).map((role) => {
			const apiModel = config.voice.model !== "codex-live-1.1";
			const codexKey = role === "primary" ? "v3Voice" : "v3AlternateVoice";
			const realtimeKey =
				role === "primary" ? "realtimeVoice" : "realtimeAlternateVoice";
			const key = apiModel ? realtimeKey : codexKey;
			const item = {
				id: role === "primary" ? "voice" : "alternateVoice",
				label: role === "primary" ? "Primary voice" : "Alternate voice",
				description:
					"Applies on the next call. Session voice transfers alternate between these voices.",
				currentValue: formatVoiceName(config.voice[key]),
				values: (apiModel ? OPENAI_REALTIME_VOICES : REALTIME_V3_VOICES).map(
					formatVoiceName,
				),
			};
			const update = (
				value: string,
				current: CodexConversionConfig,
			): CodexConversionConfig => {
				const name = value.toLowerCase();
				return {
					...current,
					voice: apiModel
						? {
								...current.voice,
								[realtimeKey]:
									OPENAI_REALTIME_VOICES.find((voice) => voice === name) ??
									current.voice[realtimeKey],
							}
						: {
								...current.voice,
								[codexKey]:
									normalizeRealtimeV3Voice(name) ?? current.voice[codexKey],
							},
				};
			};
			return setting(item, update);
		}),
		...(config.voice.model !== "codex-live-1.1"
			? [
					setting(
						{
							id: "webSearch",
							label: "Realtime web search",
							description:
								webSearchAvailable === false
									? "Web Run is not loaded. Load the Web Run extension and set up its account, or leave search off. Applies on the next call."
									: "Requires the Web Run extension and its account setup. Applies on the next call.",
							currentValue: config.voice.webSearch ? "on" : "off",
							values: ["off", "on"],
						},
						(
							value: string,
							current: CodexConversionConfig,
						): CodexConversionConfig => ({
							...current,
							voice: { ...current.voice, webSearch: value === "on" },
						}),
					),
				]
			: []),
		setting(
			{
				id: "autoResumeRealtime",
				description:
					"Reconnect automatically if an active realtime voice call drops.",
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
				description:
					"Let the voice model speak a brief acknowledgement when handing a task to the coding agent.",
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
				description:
					"Let voice relay reasoning summaries as progress when the coding agent has no spoken text update.",
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
				description:
					"Hold the shortcut to record and release to finish, or press once to start and again to stop.",
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
				description:
					"Choose a model to summarize the coding session for voice startup. Off starts voice without that summary.",
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
				description:
					"Set reasoning effort for the voice context summary, where the selected model supports it.",
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
				description:
					"Summarize and start a fresh voice call at each context rollover or compaction. Requires a summarization model.",
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

function formatVoiceModel(model: string): string {
	if (model === "realtime-2.1") return "GPT-Realtime-2.1 (API)";
	if (model === "realtime-2.1-mini") return "GPT-Realtime-2.1 Mini (API)";
	return "Codex Live (OAuth)";
}
