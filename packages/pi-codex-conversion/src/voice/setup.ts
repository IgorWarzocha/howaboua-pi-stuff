import { DEFAULT_CODEX_CONVERSION_CONFIG, type CodexConversionConfig } from "../adapter/activation/config.ts";
import { getCodexConversionConfigPath } from "../adapter/activation/config-store.ts";
import type { CodexVoiceMode } from "./ui.ts";

export type VoiceAudioSetting = "voice.inputDevice" | "voice.outputDevice";

export function missingVoiceAudioSettings(config: CodexConversionConfig, mode: "realtime" | "dictation"): VoiceAudioSetting[] {
	return [
		...(!config.voice.inputDevice ? ["voice.inputDevice" as const] : []),
		...(mode === "realtime" && !config.voice.outputDevice ? ["voice.outputDevice" as const] : []),
	];
}

export function formatVoiceAudioError(error: Error, mode: CodexVoiceMode, config: CodexConversionConfig): string {
	const direction = audioErrorDirection(error.message, mode);
	if (!direction) return error.message;
	const input = direction === "input";
	const setting = input ? "voice.inputDevice" : "voice.outputDevice";
	const device = input ? config.voice.inputDevice : config.voice.outputDevice;
	return [
		`Codex voice could not open ${direction} device \`${device ?? "default"}\`.`,
		"It may be busy, unavailable, or the wrong endpoint in a routed or processed audio setup.",
		"Ask your Pi agent to resolve the audio setup, or paste this message into the prompt.",
		`Agent: inspect the available audio devices and routes. If multiple endpoints are plausible, ask the user which they want. Update only \`${setting}\` in \`${getCodexConversionConfigPath()}\`. For shared or processed audio, prefer the final virtual/system source rather than opening physical hardware directly. Then ask the user to try using voice features again.`,
		`Audio backend: ${error.message}`,
	].join("\n");
}

function audioErrorDirection(message: string, mode: CodexVoiceMode): "input" | "output" | undefined {
	const normalized = message.toLowerCase();
	if (/microphone|default input|input (?:device|stream|format)/.test(normalized)) return "input";
	if (/speaker|default output|output (?:device|stream|format)/.test(normalized)) return "output";
	if (mode === "dictation" && /(?:requested )?device|audio (?:device|stream)|capture stream|sample format/.test(normalized)) return "input";
	return undefined;
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
			`No pi-codex-voice helper is available for ${process.platform}-${process.arch}. Build it locally, set tools.customRustBinariesDir in ${options.configPath}, then run /reload.`,
		].join("\n");
	}
	return [...lines,
		`Audio helper: ${options.helperPath}`,
		'Use its {"type":"list_devices"} JSONL command to inspect available devices.',
		"Configure the missing audio settings with exact device id values. If multiple plausible devices are available, ask the user which they prefer. Investigate ambiguity as needed; do not guess.",
		"Preserve every other config value.",
		`Explain the default controls: hold ${formatVoiceShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.dictationShortcut)} to dictate and release to transcribe into Pi; ${formatVoiceShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.realtimeShortcut)} toggles realtime voice; ${formatVoiceShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.muteShortcut)} mutes its microphone; ${formatVoiceShortcut(DEFAULT_CODEX_CONVERSION_CONFIG.voice.serverShortcut)} toggles the LAN voice server. Push mode follows key releases when available and key-repeat continuity otherwise; toggle behavior is selectable in /codex voice. Keybinds and behavior can also be changed in ${options.configPath}; keybind changes take effect after /reload.`,
		`Read the Realtime System Prompt at ${options.realtimePromptPath} before finishing.`,
		"When explaining customization, clarify that this is not Pi's system prompt or AGENTS.md: voice only listens, speaks, and routes work; it has no direct tool or file access, and actual work remains in the Pi session. Advise against copying technical instructions into it.",
		`After device setup, mention that the global Realtime System Prompt can be customized and ask whether the user wants you to open it. Also explain that a trusted workspace can add plain Markdown voice instructions${options.projectRealtimePromptPath ? ` at ${options.projectRealtimePromptPath}` : " in its Pi config directory"}; the extension appends it under Project level instructions. Do not create or edit either file unless asked.`,
		`After saving, tell the user to run ${options.retryCommand} again.`,
	].join("\n");
}

export function formatVoiceShortcut(value: string): string {
	return value.split("+").map((part) => part === "ctrl" ? "Ctrl" : part === "alt" ? "Alt" : part === "shift" ? "Shift" : part === "space" ? "Space" : part.toUpperCase()).join("+");
}
