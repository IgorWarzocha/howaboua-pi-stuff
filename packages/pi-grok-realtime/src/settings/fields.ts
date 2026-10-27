import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SettingItem } from "@earendil-works/pi-tui";
import {
	CONTEXT_REASONING,
	type GrokRealtimeConfig,
	MODELS,
	SPEEDS,
	VOICES,
} from "../config.ts";
import type { createSettingsSubmenus } from "./submenus.ts";
export function buildGrokSettings(
	config: GrokRealtimeConfig,
	ctx: ExtensionContext,
	{
		input,
		chooser,
	}: Pick<ReturnType<typeof createSettingsSubmenus>, "input" | "chooser">,
): (SettingItem & { id: SettingKey })[] {
	return [
		{
			id: "access",
			label: "Pi xAI access",
			currentValue: config.access,
			values: ["oauth", "api_key"],
			description:
				"Uses the matching active Pi credential for voice and dictation",
		},
		{
			id: "autoResume",
			label: "Resume dropped voice calls",
			currentValue: config.autoResume ? "on" : "off",
			values: ["off", "on"],
			description: "One replacement attempt after an established call drops",
		},
		...(["voiceShortcut", "dictationShortcut"] as const).map((id) => ({
			id,
			label: id === "voiceShortcut" ? "Voice shortcut" : "Dictation shortcut",
			currentValue: config[id],
			description: "Run /reload after changing; empty disables",
			submenu: (current: string, back: (value?: string) => void) =>
				input(
					id,
					"Pi shortcut · empty disables · /reload after changing",
					current,
					back,
					() => back(),
				),
		})),
		{
			id: "contextModel",
			label: "Context summary model",
			currentValue: config.contextModel,
			submenu: chooser(
				"contextModel",
				"Context summary model",
				[
					"current",
					"off",
					...ctx.modelRegistry
						.getAvailable()
						.map((model) => `${model.provider}/${model.id}`),
				],
				"Enter provider/modelId…",
			),
		},
		{
			id: "contextReasoning",
			label: "Context summary reasoning",
			currentValue: config.contextReasoning,
			values: [...CONTEXT_REASONING],
		},
		{
			id: "voice",
			label: "Primary voice",
			currentValue: config.voice,
			submenu: chooser(
				"voice",
				"Voice · availability depends on your account",
				VOICES,
				"Enter custom voice ID…",
			),
		},
		{
			id: "alternateVoice",
			label: "Alternate voice",
			currentValue: config.alternateVoice,
			description:
				"Session transfers alternate between primary and alternate voices",
			submenu: chooser(
				"alternateVoice",
				"Alternate voice · availability depends on your account",
				VOICES,
				"Enter custom voice ID…",
			),
		},
		{
			id: "model",
			label: "Model",
			currentValue: config.model,
			submenu: chooser(
				"model",
				"Realtime model · availability depends on your account",
				MODELS,
				"Enter custom model ID…",
			),
		},
		{
			id: "reasoning",
			label: "Reasoning",
			currentValue: config.reasoning,
			values: ["high", "none"],
		},
		{
			id: "webSearch",
			label: "Native web search",
			currentValue: config.webSearch ? "on" : "off",
			values: ["off", "on"],
			description:
				"xAI executes searches directly, bypassing Pi. Extra provider tool charges apply.",
		},
		{
			id: "speed",
			label: "Speed",
			currentValue: String(config.speed),
			submenu: chooser(
				"speed",
				"Speech speed",
				SPEEDS.map(String),
				"Enter speed…",
			),
		},
		{
			id: "language",
			label: "Language",
			currentValue: config.language,
			submenu: (current, back) =>
				input("language", "Language: auto or BCP 47 tag", current, back, () =>
					back(),
				),
		},
		{
			id: "silenceSeconds",
			label: "Follow-up after silence (seconds)",
			currentValue: String(config.silenceSeconds),
			description: "0 turns follow-up off",
			submenu: (current, back) =>
				input(
					"silenceSeconds",
					"Follow-up after silence in seconds: 0 off",
					current,
					back,
					() => back(),
				),
		},
	];
}

export type SettingKey = Exclude<keyof GrokRealtimeConfig, "port">;

export function settingPatch(id: SettingKey, value: string): unknown {
	const trimmed = value.trim();
	return {
		[id]:
			id === "webSearch" || id === "autoResume"
				? trimmed === "on"
				: (id === "speed" || id === "silenceSeconds") && trimmed
					? Number(trimmed)
					: trimmed,
	};
}
