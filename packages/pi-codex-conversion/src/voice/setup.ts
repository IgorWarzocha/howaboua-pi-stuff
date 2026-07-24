import type { CodexConversionConfig } from "../adapter/activation/config.ts";

export type VoiceAudioSetting = "voice.inputDevice" | "voice.outputDevice";

export function missingVoiceAudioSettings(config: CodexConversionConfig): VoiceAudioSetting[] {
	return [
		...(!config.voice.inputDevice ? ["voice.inputDevice" as const] : []),
		...(!config.voice.outputDevice ? ["voice.outputDevice" as const] : []),
	];
}

export function buildVoiceSetupInstructions(options: {
	configPath: string;
	helperPath: string | undefined;
	missing: VoiceAudioSetting[];
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
		`Enumerate devices with this helper: ${options.helperPath}`,
		"Write these JSONL commands to its standard input:",
		'{"type":"list_devices"}',
		'{"type":"shutdown"}',
		"Use device id values, not display names. If multiple usable devices exist for a missing setting, show the names and IDs and ask the user which one to use. Do not choose for them.",
		"Set voice.inputDevice to the selected input id and voice.outputDevice to the selected output id, but only when that setting is missing.",
		"Update only the missing settings under voice. Preserve every other config value.",
		`After saving, tell the user to run ${options.retryCommand} again.`,
	].join("\n");
}
