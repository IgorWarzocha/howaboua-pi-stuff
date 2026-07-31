import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCodexConversionConfigPath, readCodexConversionConfig } from "../adapter/activation/config-store.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { resolveVoiceHelperBinary } from "./binary.ts";
import type { CodexVoiceController } from "./controller.ts";
import type { CodexLanVoiceServerController } from "./lan/controller.ts";
import { buildVoiceSetupInstructions, missingVoiceAudioSettings } from "./setup.ts";
import { registerCodexVoiceShortcuts } from "./shortcuts.ts";
import { getCodexVoiceSystemPromptPath, getProjectCodexVoiceSystemPromptPath } from "./system-prompt.ts";
import { codexVoiceSetupMessage, type CodexVoiceMode } from "./ui.ts";

export interface CodexVoiceControls {
	start(mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void>;
	stop(ctx: ExtensionContext): Promise<void>;
	toggleInputMute(ctx: ExtensionContext): void;
}

export function createCodexVoiceControls(options: {
	pi: ExtensionAPI;
	state: AdapterState;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
}): CodexVoiceControls {
	const { pi, state, voice, lanVoice } = options;

	const start = async (mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === mode) return;
		const currentConfig = readCodexConversionConfig();
		state.config = currentConfig;
		const missingAudioSettings = missingVoiceAudioSettings(currentConfig, mode);
		if (missingAudioSettings.length > 0) {
			if (mode === "realtime" && voice.prepareRealtimePrompt(ctx) === undefined) return;
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn before setting up Codex voice.", "info");
				return;
			}
			state.codexTurnState.beginTurn();
			pi.sendMessage(codexVoiceSetupMessage(buildVoiceSetupInstructions({
				configPath: getCodexConversionConfigPath(),
				helperPath: resolveVoiceHelperBinary(currentConfig.tools.customRustBinariesDir),
				missing: missingAudioSettings,
				...(ctx.isProjectTrusted() ? { projectRealtimePromptPath: getProjectCodexVoiceSystemPromptPath(ctx.cwd) } : {}),
				realtimePromptPath: getCodexVoiceSystemPromptPath(),
				retryCommand: `/codex voice ${mode}`,
			})), { triggerTurn: true });
			return;
		}
		await voice.start(ctx, currentConfig, mode);
	};

	const stop = async (_ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === "dictation") await voice.finishDictation({ announce: true });
		else await voice.stop({ announce: true });
	};

	const toggle = async (mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === mode) await stop(ctx);
		else await start(mode, ctx);
	};

	const toggleInputMute = (ctx: ExtensionContext): void => {
		const muted = !voice.inputMuted;
		if (!voice.setInputMuted(muted)) {
			ctx.ui.notify("Start realtime voice before muting the microphone", "info");
			return;
		}
		ctx.ui.notify(`Realtime microphone ${muted ? "muted" : "unmuted"}`, "info");
	};

	registerCodexVoiceShortcuts(pi, state.config, () => state.config, {
		startDictation: (ctx) => start("dictation", ctx),
		finishDictation: (ctx) => stop(ctx),
		toggleDictation: (ctx) => toggle("dictation", ctx),
		toggleRealtime: (ctx) => toggle("realtime", ctx),
		toggleInputMute,
		toggleServer: async (ctx) => {
			const enabled = !lanVoice.status().running;
			await lanVoice.setEnabled(enabled, ctx);
			if (!enabled) ctx.ui.notify("LAN voice server stopped", "info");
		},
	});

	return { start, stop, toggleInputMute };
}
