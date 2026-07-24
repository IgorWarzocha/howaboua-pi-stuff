import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	getCodexConversionConfigPath,
	normalizeCodexVerbosity,
	readCodexConversionConfig,
	writeCodexConversionConfig,
	type CodexConversionConfig,
} from "../../adapter/activation/config.ts";
import { syncAdapter } from "../../adapter/activation/activation.ts";
import type { AdapterState } from "../../adapter/activation/state.ts";
import { openCodexSettingsScreen } from "./ui.ts";
import { consumeCodexRateLimitResetCredit, fetchCodexUsage, formatCodexUsage } from "./usage.ts";
import type { BackgroundBashWidgetState } from "../background-bash-widget.ts";
import { renderBackgroundBashWidget } from "../background-bash-widget.ts";
import type { ExecSessionManager } from "../../tools/exec/session-manager.ts";
import type { CodexVoiceController } from "../../voice/controller.ts";
import { resolveVoiceHelperBinary } from "../../voice/binary.ts";
import { buildVoiceSetupInstructions, missingVoiceAudioSettings } from "../../voice/setup.ts";
import { getCodexVoiceSystemPromptPath } from "../../voice/system-prompt.ts";
import { codexVoiceSetupMessage } from "../../voice/ui.ts";

const CODEX_COMMAND_COMPLETIONS = ["all", "status", "fast", "compact", "voice", "voice realtime", "voice dictation", "voice stop", "usage", "reset", "ps", "low", "medium", "high"] as const;
const CODEX_USAGE = "Usage: /codex, /codex all, /codex status, /codex fast, /codex compact, /codex voice [realtime|dictation|stop], /codex usage, /codex reset, /codex ps, /codex low|medium|high";

export function registerCodexCommand(
	pi: ExtensionAPI,
	state: AdapterState,
	voice: CodexVoiceController,
	onConfigApplied?: (config: CodexConversionConfig, ctx: ExtensionContext) => void,
	backgroundShells?: { sessions: ExecSessionManager; widget: BackgroundBashWidgetState } | undefined,
): void {
	function saveAndApply(ctx: ExtensionContext, nextConfig: CodexConversionConfig): boolean {
		const writeResult = writeCodexConversionConfig(nextConfig);
		if (!writeResult.ok) {
			ctx.ui.notify(`Failed to save Codex settings: ${writeResult.error}`, "error");
			return false;
		}
		state.config = nextConfig;
		onConfigApplied?.(nextConfig, ctx);
		syncAdapter(pi, ctx, state);
		return true;
	}

	pi.registerCommand("codex", {
		description: "Configure Codex adapter settings",
		getArgumentCompletions: (prefix) =>
			CODEX_COMMAND_COMPLETIONS.filter((item) => item.startsWith(prefix.trim().toLowerCase())).map((value) => ({ label: value, value })),
			handler: async (args, ctx) => {
			state.config = readCodexConversionConfig();
			const arg = args.trim().toLowerCase();
			if (arg === "ps") {
				if (state.config.voiceFeaturesOnly) {
					ctx.ui.notify("Background shells are disabled in voice-only mode.", "info");
					return;
				}
				if (!state.config.ui.backgroundShellWidget) {
					ctx.ui.notify("Background shells widget is off.", "info");
					return;
				}
				if (!backgroundShells || backgroundShells.sessions.listSessions().length === 0) {
					ctx.ui.notify("No background shells running.", "info");
					return;
				}
				backgroundShells.widget.ctx = ctx;
				backgroundShells.widget.folded = false;
				renderBackgroundBashWidget(ctx, backgroundShells.widget, backgroundShells.sessions);
				return;
			}
			if (arg === "usage" || arg === "reset") {
				let usage;
				try {
					usage = await fetchCodexUsage(ctx);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					if (!ctx.hasUI) {
						ctx.ui.notify(message, "error");
						return;
					}
					await openCodexSettingsScreen(ctx, {
						initialConfig: state.config,
						initialTab: "usage",
						initialUsage: { error: message },
						onChange: (config) => saveAndApply(ctx, config),
					});
					return;
				}
				if (!ctx.hasUI) {
					ctx.ui.notify(formatCodexUsage(usage), "info");
					return;
				}
				await openCodexSettingsScreen(ctx, {
					initialConfig: state.config,
					initialTab: "usage",
					initialUsage: usage,
					onConsumeResetCredit: (redeemRequestId) => consumeCodexRateLimitResetCredit(ctx, redeemRequestId),
					onChange: (config) => saveAndApply(ctx, config),
				});
				return;
			}
			if (arg === "compact") {
				if (!ctx.hasUI) {
					ctx.ui.notify(formatCodexSettings(state.config), "info");
					return;
				}
				await openCodexSettingsScreen(ctx, {
					initialConfig: state.config,
					initialTab: "openai",
					onChange: (config) => saveAndApply(ctx, config),
				});
				return;
			}
			if (arg === "voice") {
				if (!ctx.hasUI) { ctx.ui.notify(formatCodexSettings(state.config), "info"); return; }
				await openCodexSettingsScreen(ctx, {
					initialConfig: state.config,
					initialTab: "voice",
					onChange: (config) => saveAndApply(ctx, config),
				});
				return;
			}
			if (arg === "voice realtime" || arg === "voice dictation") {
				if (ctx.mode !== "tui") { ctx.ui.notify("Codex voice requires interactive TUI mode", "error"); return; }
				const requestedMode = arg === "voice dictation" ? "dictation" : "realtime";
				if (voice.activeMode === requestedMode) return;
				await ctx.waitForIdle();
				const missingAudioSettings = missingVoiceAudioSettings(state.config);
				if (missingAudioSettings.length > 0) {
					state.codexTurnState.beginTurn();
					pi.sendMessage(codexVoiceSetupMessage(buildVoiceSetupInstructions({
						configPath: getCodexConversionConfigPath(),
						helperPath: resolveVoiceHelperBinary(),
						missing: missingAudioSettings,
						realtimePromptPath: getCodexVoiceSystemPromptPath(),
						retryCommand: `/codex ${arg}`,
					})), { triggerTurn: true });
					return;
				}
				const nextConfig = withVoiceMode(state.config, requestedMode);
				if (!saveAndApply(ctx, nextConfig)) return;
				try { await voice.start(ctx, nextConfig); }
				catch (error) { if (voice.status !== "failed") ctx.ui.notify(error instanceof Error ? error.message : String(error), "error"); }
				return;
			}
			if (arg === "voice stop") {
				if (ctx.mode !== "tui") { ctx.ui.notify("Codex voice requires interactive TUI mode", "error"); return; }
				await ctx.waitForIdle();
				await voice.stop({ announce: true });
				return;
			}
			const nextConfig = getCommandConfigUpdate(arg, state.config);
			if (nextConfig) {
				saveAndApply(ctx, nextConfig);
				return;
			}

			if (arg) {
				ctx.ui.notify(CODEX_USAGE, "warning");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify(formatCodexSettings(state.config), "info");
				return;
			}

			await openCodexSettingsScreen(ctx, {
				initialConfig: state.config,
				onChange: (config) => saveAndApply(ctx, config),
			});
		},
	});
}

function withVoiceMode(config: CodexConversionConfig, mode: "realtime" | "dictation"): CodexConversionConfig {
	return {
		...config,
		voice: {
			...config.voice,
			mode: mode === "dictation" ? "transcription" : "conversational",
			protocol: mode === "dictation" ? "v2" : "v3",
		},
	};
}

function getCommandConfigUpdate(arg: string, config: CodexConversionConfig): CodexConversionConfig | undefined {
	if (arg === "fast") return { ...config, openai: { ...config.openai, fast: !config.openai.fast } };
	if (arg === "all") return { ...config, scope: { ...config.scope, allProviders: nextAllProvidersMode(config.scope.allProviders) } };
	if (arg === "status") return { ...config, ui: { ...config.ui, statusLine: !config.ui.statusLine } };
	const verbosity = normalizeCodexVerbosity(arg);
	return verbosity ? { ...config, openai: { ...config.openai, verbosity } } : undefined;
}

function nextAllProvidersMode(value: CodexConversionConfig["scope"]["allProviders"]): CodexConversionConfig["scope"]["allProviders"] {
	if (value === "off") return "on";
	if (value === "on") return "extras";
	return "off";
}

function formatAllProvidersMode(value: CodexConversionConfig["scope"]["allProviders"]): string {
	return value === "extras" ? "only extras" : value;
}

function formatCodexSettings(config: CodexConversionConfig): string {
	const extraTools = [
		config.tools.applyPatchOnly ? "apply_patch" : undefined,
		config.tools.viewImageOnly ? "view_image" : undefined,
		config.tools.webRunOnly ? "web_run" : undefined,
		config.tools.imageGenerationOnly ? "imagegen" : undefined,
	].filter(Boolean).join(", ") || "off";
	const compactionVersion = config.compaction.version ?? "v1";
	return `Codex settings: voice only ${config.voiceFeaturesOnly ? "on" : "off"}, all models ${formatAllProvidersMode(config.scope.allProviders)}, additional providers ${config.scope.additionalProviders.length > 0 ? config.scope.additionalProviders.join(", ") : "none"}, statusline ${config.ui.statusLine ? "on" : "off"}, tool renaming ${config.ui.toolRenaming ? "on" : "off"}, compact tools ${config.ui.compactTools ? "on" : "off"}, Code Mode details ${config.ui.codeModeDetails ? "on" : "off"}, background shells widget ${config.ui.backgroundShellWidget ? "on" : "off"}, image descriptions ${config.tools.viewImageFallback ? "on" : "off"}, extra tools only ${extraTools}, fast ${config.openai.fast ? "on" : "off"}, cached websocket upgrade ${config.openai.forceCachedWebSockets === false ? "off" : "on"}, voice preference ${config.voice.mode === "transcription" ? "dictation" : "conversation"} ${config.voice.protocol}/${config.voice.protocol === "v2" ? config.voice.v2Voice : config.voice.v3Voice}, GPT-5.6 Code Mode ${config.beta.codeMode ? "on" : "off"}, proxy Responses Lite ${config.beta.responsesLite ? "on" : "off"}, responses compaction ${(config.compaction.responsesCompaction ?? false) ? "on" : "off"} (${compactionVersion}), verbosity ${config.openai.verbosity}`;
}
