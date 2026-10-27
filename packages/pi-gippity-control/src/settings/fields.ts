import type { Theme } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import {
	type GippityControlConfig,
	normalizeRealtimeV3Voice,
	normalizeVoiceContextReasoning,
	REALTIME_V3_VOICES,
	VOICE_CONTEXT_REASONING_LEVELS,
	type VoiceContextModel,
} from "../config.ts";
import { nativeDevicePicker } from "../native-device-picker.ts";
import type { CodexLanVoiceServerController } from "../voice/lan/controller.ts";
export interface Setting extends SettingItem {
	update?(value: string, config: GippityControlConfig): GippityControlConfig;
}

export function buildGippitySettings(
	config: GippityControlConfig,
	lanVoice: CodexLanVoiceServerController,
	contextModels: Map<string, VoiceContextModel>,
	theme: Theme,
	tui: { requestRender(): void },
): Setting[] {
	return [
		...(["inputDevice", "outputDevice"] as const).map(
			(key): Setting => ({
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
			}),
		),
		{
			id: "server",
			label: "Control server",
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
			id: "voice",
			label: "Primary voice",
			currentValue: formatVoiceName(config.voice.v3Voice),
			values: REALTIME_V3_VOICES.map(formatVoiceName),
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					v3Voice:
						normalizeRealtimeV3Voice(value.toLowerCase()) ??
						current.voice.v3Voice,
				},
			}),
		},
		{
			id: "alternateVoice",
			label: "Alternate voice",
			currentValue: formatVoiceName(config.voice.v3AlternateVoice),
			values: REALTIME_V3_VOICES.map(formatVoiceName),
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					v3AlternateVoice:
						normalizeRealtimeV3Voice(value.toLowerCase()) ??
						current.voice.v3AlternateVoice,
				},
			}),
		},
		{
			id: "autoResumeRealtime",
			label: "Auto-resume realtime voice",
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
		{
			id: "delegationAcknowledgements",
			label: "Speak delegation acknowledgements",
			currentValue: config.voice.delegationAcknowledgements ? "on" : "off",
			values: ["off", "on"],
			update: (value, current) => ({
				...current,
				voice: {
					...current.voice,
					delegationAcknowledgements: value === "on",
				},
			}),
		},
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
