import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { getCodexConversionConfigPath, readCodexConversionConfig } from "../adapter/activation/config-store.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { resolveVoiceHelperBinary } from "./binary.ts";
import type { CodexVoiceController } from "./controller.ts";
import { buildVoiceSetupInstructions, missingVoiceAudioSettings } from "./setup.ts";
import { registerCodexVoiceShortcuts } from "./shortcuts.ts";
import { getCodexVoiceSystemPromptPath, getProjectCodexVoiceSystemPromptPath } from "./system-prompt.ts";
import { codexVoiceSetupMessage, type CodexVoiceMode } from "./ui.ts";

export interface CodexVoiceControls {
	start(mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void>;
	stop(ctx: ExtensionContext): Promise<void>;
}

export function createCodexVoiceControls(options: {
	pi: ExtensionAPI;
	state: AdapterState;
	voice: CodexVoiceController;
	saveAndApply(ctx: ExtensionContext, config: CodexConversionConfig): boolean;
}): CodexVoiceControls {
	const { pi, state, voice, saveAndApply } = options;

	const start = async (mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === mode) return;
		const currentConfig = readCodexConversionConfig();
		state.config = currentConfig;
		const missingAudioSettings = missingVoiceAudioSettings(currentConfig, mode);
		if (missingAudioSettings.length > 0) {
			if (!ctx.isIdle()) {
				ctx.ui.notify("Wait for the current turn before setting up Codex voice.", "info");
				return;
			}
			state.codexTurnState.beginTurn();
			pi.sendMessage(codexVoiceSetupMessage(buildVoiceSetupInstructions({
				configPath: getCodexConversionConfigPath(),
				helperPath: resolveVoiceHelperBinary(),
				missing: missingAudioSettings,
				...(ctx.isProjectTrusted() ? { projectRealtimePromptPath: getProjectCodexVoiceSystemPromptPath(ctx.cwd) } : {}),
				realtimePromptPath: getCodexVoiceSystemPromptPath(),
				retryCommand: `/codex voice ${mode}`,
			})), { triggerTurn: true });
			return;
		}
		const nextConfig = withVoiceMode(currentConfig, mode);
		if (saveAndApply(ctx, nextConfig)) await voice.start(ctx, nextConfig);
	};

	const stop = async (_ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === "dictation") await voice.finishDictation({ announce: true });
		else await voice.stop({ announce: true });
	};

	const toggle = async (mode: CodexVoiceMode, ctx: ExtensionContext): Promise<void> => {
		if (voice.activeMode === mode) await stop(ctx);
		else await start(mode, ctx);
	};

	registerCodexVoiceShortcuts(pi, state.config, () => state.config, {
		startDictation: (ctx) => start("dictation", ctx),
		finishDictation: (ctx) => stop(ctx),
		toggleDictation: (ctx) => toggle("dictation", ctx),
		toggleRealtime: (ctx) => toggle("realtime", ctx),
	});

	return { start, stop };
}

function withVoiceMode(config: CodexConversionConfig, mode: CodexVoiceMode): CodexConversionConfig {
	return {
		...config,
		voice: {
			...config.voice,
			mode: mode === "dictation" ? "transcription" : "conversational",
			protocol: mode === "dictation" ? "v2" : "v3",
		},
	};
}
