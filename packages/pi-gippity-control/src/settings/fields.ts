import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import {
	GIPPITY_VOICE_MODELS,
	GIPPITY_VOICE_MODEL_OPTIONS,
	type GippityControlConfig,
	normalizeRealtimeV3Voice,
	normalizeVoiceContextReasoning,
	OPENAI_REALTIME_VOICES,
	REALTIME_V3_VOICES,
	VOICE_CONTEXT_REASONING_LEVELS,
	type VoiceContextModel,
} from "../config.ts";
import { nativeDevicePicker } from "../native-device-picker.ts";
import type { CodexLanVoiceServerController } from "../voice/lan/controller.ts";
import { ApiProviderPicker } from "./api-provider-picker.ts";
export interface Setting extends SettingItem {
	update?(value: string, config: GippityControlConfig): GippityControlConfig;
}

export function buildGippitySettings(
	config: GippityControlConfig,
	lanVoice: CodexLanVoiceServerController,
	contextModels: Map<string, VoiceContextModel>,
	theme: Theme,
	tui: { requestRender(): void },
	webSearchAvailable?: boolean,
): Setting[] {
	const { kind } = GIPPITY_VOICE_MODEL_OPTIONS[config.voice.model];
	const apiModel = kind !== "codex";
	return [
		...(["inputDevice", "outputDevice"] as const).map((key): Setting => ({
			id: key,
			label: key === "inputDevice" ? "Microphone" : "Speaker",
			description:
				"Native audio only; applies on the next local start. Browser and handed-off audio keep their own devices.",
			currentValue: config.voice[key] ?? "System default",
			submenu: (_value, back) =>
				nativeDevicePicker(key, config.voice[key], back, theme, () =>
					tui.requestRender(),
				),
			update: (value, current) => {
				const voice = { ...current.voice, audioSetupCompleted: true };
				if (value) voice[key] = value;
				else delete voice[key];
				return { ...current, voice };
			},
		})),
		{
			id: "server",
			label: "Control server",
			description:
				"Let browsers on your network control this Pi session without signing in. Stops when the Pi session changes.",
			currentValue: lanVoice.status().running ? "on" : "off",
			values: ["off", "on"],
		},
		{
			id: "webApp",
			label: "Control server web app",
			currentValue: config.lan.customWebApp ? "custom" : "bundled",
			values: ["bundled", "custom"],
			update: (value, current) => ({
				...current,
				lan: { ...current.lan, customWebApp: value === "custom" },
			}),
		},

		{
			id: "voiceModel",
			label: "Voice model",
			description:
				"Codex Live uses your Codex login. API models require an API key and are billed separately. Applies on the next call.",
			currentValue: GIPPITY_VOICE_MODEL_OPTIONS[config.voice.model].label,
			values: GIPPITY_VOICE_MODELS.map(
				(model) => GIPPITY_VOICE_MODEL_OPTIONS[model].label,
			),
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					model:
						GIPPITY_VOICE_MODELS.find(
							(model) => GIPPITY_VOICE_MODEL_OPTIONS[model].label === value,
						) ?? current.voice.model,
				},
			}),
		},
		...(apiModel
			? [
					{
						id: "apiProvider",
						label: "API provider",
						description:
							"Exact Pi provider name. Uses its API key and endpoint on the next call. Default: openai.",
						currentValue: config.voice.apiProvider,
						submenu: (value: string, back: (value?: string) => void) =>
							new ApiProviderPicker(value, back, theme),
						update: (value: string, current: GippityControlConfig) => ({
							...current,
							voice: { ...current.voice, apiProvider: value },
						}),
					},
				]
			: []),
		...(kind === "codex"
			? [
					{
						id: "taskDelegationModel",
						label: "Task delegation model",
						currentValue: config.voice.taskDelegationModel,
					},
					{
						id: "taskDelegationReasoning",
						label: "Task delegation reasoning",
						currentValue: config.voice.taskDelegationReasoning,
						values: [...VOICE_CONTEXT_REASONING_LEVELS],
						update: (value: string, current: GippityControlConfig) => ({
							...current,
							voice: {
								...current.voice,
								taskDelegationReasoning: normalizeVoiceContextReasoning(value),
							},
						}),
					},
				]
			: []),
		...(["primary", "alternate"] as const).map((role) => {
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
				current: GippityControlConfig,
			): GippityControlConfig => {
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
			return { ...item, update };
		}),
		...(kind === "realtime"
			? [
					{
						id: "webSearch",
						label: "Realtime web search",
						description:
							webSearchAvailable === false
								? "Web Run is not loaded. Load the Web Run extension and set up its account, or leave search off. Applies on the next call."
								: "Requires the Web Run extension and its account setup. Applies on the next call.",
						currentValue: config.voice.webSearch ? "on" : "off",
						values: ["off", "on"],
						update: (
							value: string,
							current: GippityControlConfig,
						): GippityControlConfig => ({
							...current,
							voice: { ...current.voice, webSearch: value === "on" },
						}),
					},
				]
			: []),
		{
			id: "autoResumeRealtime",
			label: "Auto-resume realtime voice",
			description:
				"Try to start a replacement when an established voice call drops.",
			currentValue: config.voice.autoResumeRealtime ? "on" : "off",
			values: ["off", "on"],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					autoResumeRealtime: value === "on",
				},
			}),
		},
		...(kind === "codex"
			? [
					{
						id: "delegationAcknowledgements",
						label: "Speak delegation acknowledgements",
						currentValue: config.voice.delegationAcknowledgements
							? "on"
							: "off",
						values: ["off", "on"],
						update: (value: string, current: GippityControlConfig) => ({
							...current,
							voice: {
								...current.voice,
								delegationAcknowledgements: value === "on",
							},
						}),
					},
				]
			: []),
		{
			id: "forwardReasoningSummaries",
			label: "Forward reasoning summaries for compatible models",
			currentValue: config.voice.forwardReasoningSummaries ? "on" : "off",
			values: ["off", "on"],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					forwardReasoningSummaries: value === "on",
				},
			}),
		},
		{
			id: "dictationMode",
			label: "Dictation key behavior",
			description:
				"Hold the shortcut to record and release to finish, or press once to start and again to stop.",
			currentValue:
				config.voice.dictationShortcutMode === "push"
					? "push to dictate"
					: "toggle",
			values: ["push to dictate", "toggle"],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					dictationShortcutMode: value === "toggle" ? "toggle" : "push",
				},
			}),
		},
		{
			id: "contextModel",
			label: "Voice context model",
			description:
				"Give voice calls a summary of the Pi conversation. Off starts calls without that summary.",
			currentValue: config.voice.contextModel
				? formatContextModel(config.voice.contextModel)
				: "off",
			values: [
				"off",
				...new Set([
					...(config.voice.contextModel
						? [formatContextModel(config.voice.contextModel)]
						: []),
					...[...contextModels.keys()].sort(),
				]),
			],
			update: (value, current) => {
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
		},
		{
			id: "contextReasoning",
			label: "Voice context reasoning",
			currentValue: config.voice.contextReasoning,
			values: [...VOICE_CONTEXT_REASONING_LEVELS],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					contextReasoning: normalizeVoiceContextReasoning(value),
				},
			}),
		},
		{
			id: "refreshRealtimeAfterCompaction",
			label: "Refresh realtime voice after compaction",
			description:
				"After compaction, replace the active call if a fresh context summary is available. Requires a Voice context model.",
			currentValue: config.voice.refreshRealtimeAfterCompaction ? "on" : "off",
			values: ["off", "on"],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					refreshRealtimeAfterCompaction: value === "on",
				},
			}),
		},
	];
}
function formatVoiceName(voice: string): string {
	return `${voice.slice(0, 1).toUpperCase()}${voice.slice(1)}`;
}

function formatContextModel(model: VoiceContextModel): string {
	return `${model.provider}/${model.modelId}`;
}
