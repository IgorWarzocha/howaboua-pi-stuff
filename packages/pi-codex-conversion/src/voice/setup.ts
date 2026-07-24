import { DEFAULT_CODEX_CONVERSION_CONFIG, type CodexConversionConfig } from "../adapter/activation/config.ts";

export type VoiceAudioSetting = "voice.inputDevice" | "voice.outputDevice";

export function missingVoiceAudioSettings(config: CodexConversionConfig, mode: "realtime" | "dictation"): VoiceAudioSetting[] {
	return [
		...(!config.voice.inputDevice ? ["voice.inputDevice" as const] : []),
		...(mode === "realtime" && !config.voice.outputDevice ? ["voice.outputDevice" as const] : []),
	];
}

export function buildVoiceSetupInstructions(options: {
	configPath: string;
	helperPath: string | undefined;
	missing: VoiceAudioSetting[];
	projectRealtimePromptPath?: string;
	realtimePromptPath: string;
	retryCommand: string;
}): string {
	const lines = [
		"Codex voice audio setup is required.",
		`Config file: ${options.configPath}`,
		`Missing settings: ${options.missing.join(", ")}`,
	];
	if (!options.helperPath) {
		return [...lines,
			`No pi-codex-voice helper is bundled for ${process.platform}-${process.arch}. Report this problem and do not edit the config.`,
		].join("\n");
	}
	return [...lines,
		`Audio helper: ${options.helperPath}`,
		'Use its {"type":"list_devices"} JSONL command to inspect available devices.',
		"Configure the missing audio settings with exact device id values. If multiple plausible devices are available, ask the user which they prefer. Investigate ambiguity as needed; do not guess.",
		"Preserve every other config value.",
		`Explain the default controls: hold ${formatShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcut)} to dictate and release to transcribe into Pi; ${formatShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.realtimeShortcut)} toggles realtime voice. Dictation push mode needs terminal key-release support; toggle behavior is selectable in /codex voice. Keybinds and behavior can also be changed in ${options.configPath} with voice.dictationShortcut, voice.realtimeShortcut, and voice.dictationShortcutMode.`,
		`Read the Realtime System Prompt at ${options.realtimePromptPath} before finishing.`,
		"When explaining customization, clarify that this is not Pi's system prompt or AGENTS.md: voice only listens, speaks, and routes work; it has no direct tool or file access, and actual work remains in the Pi session. Advise against copying technical instructions into it.",
		`After device setup, mention that the global Realtime System Prompt can be customized and ask whether the user wants you to open it. Also explain that a trusted workspace can add plain Markdown voice instructions${options.projectRealtimePromptPath ? ` at ${options.projectRealtimePromptPath}` : " in its Pi config directory"}; the extension appends it under Project level instructions. Do not create or edit either file unless asked.`,
		`After saving, tell the user to run ${options.retryCommand} again.`,
	].join("\n");
}

function formatShortcut(value: string): string {
	return value.split("+").map((part) => part === "ctrl" ? "Ctrl" : part === "alt" ? "Alt" : part === "shift" ? "Shift" : part === "space" ? "Space" : part.toUpperCase()).join("+");
}
