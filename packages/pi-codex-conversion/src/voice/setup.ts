import type { CodexConversionConfig } from "../adapter/activation/config.ts";
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
		`Agent: inspect the available audio devices and routes. Remove \`${setting}\` in \`${getCodexConversionConfigPath()}\` to use the system default, or set an exact device id. For shared or processed audio, prefer the final virtual/system source rather than opening physical hardware directly. Then ask the user to try using voice features again.`,
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
	retryCommand: string;
}): string {
	const lines = [
		"Codex voice audio setup was requested.",
		`Config file: ${options.configPath}`,
		`Settings to configure: ${options.missing.join(", ")}`,
	];
	if (!options.helperPath) {
		return [...lines,
			`No pi-codex-voice helper is available for ${process.platform}-${process.arch}. Build it locally, set tools.customRustBinariesDir in ${options.configPath}, then run /reload.`,
		].join("\n");
	}
	return [...lines,
		`Audio helper: ${options.helperPath}`,
		'Use its {"type":"list_devices"} JSONL command to inspect available devices.',
		"Configure the requested audio settings with exact device id values. If multiple plausible devices are available, ask the user which they prefer. Investigate ambiguity as needed; do not guess.",
		"Preserve every other config value.",
		`After saving, tell the user to run ${options.retryCommand} again.`,
	].join("\n");
}

export function formatVoiceShortcut(value: string): string {
	return value.split("+").map((part) => part === "ctrl" ? "Ctrl" : part === "alt" ? "Alt" : part === "shift" ? "Shift" : part === "space" ? "Space" : part.toUpperCase()).join("+");
}
