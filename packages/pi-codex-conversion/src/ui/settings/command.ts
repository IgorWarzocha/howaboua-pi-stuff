import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { readCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config-store.ts";
import { syncAdapter } from "../../adapter/activation/activation.ts";
import type { AdapterState } from "../../adapter/activation/state.ts";
import type { CodexVoiceController } from "../../voice/controller.ts";
import { createCodexVoiceControls } from "../../voice/controls.ts";
import type { CodexLanVoiceServerController } from "../../voice/lan/controller.ts";
import { ROUTABLE_SETTINGS_TABS, parseSettingsTab, type SettingsTab } from "./tabs.ts";
import { openCodexSettingsScreen } from "./screen.ts";

const VOICE_ACTIONS = ["voice realtime", "voice mute", "voice dictation", "voice stop", "voice server"] as const;
const CODEX_COMMAND_COMPLETIONS = [...ROUTABLE_SETTINGS_TABS.map(({ id }) => id), ...VOICE_ACTIONS];
const CODEX_USAGE = "Usage: /codex [tools|openai|display|voice [realtime|mute|dictation|stop|server]|usage|about]";

export function registerCodexCommand(
	pi: ExtensionAPI,
	state: AdapterState,
	voice: CodexVoiceController,
	lanVoice: CodexLanVoiceServerController,
	onConfigApplied?: (config: CodexConversionConfig, ctx: ExtensionContext, previousConfig: CodexConversionConfig) => void,
): void {
	function saveAndApply(ctx: ExtensionContext, nextConfig: CodexConversionConfig): boolean {
		const writeResult = writeCodexConversionConfig(nextConfig);
		if (!writeResult.ok) {
			ctx.ui.notify(`Failed to save Codex settings: ${writeResult.error}`, "error");
			return false;
		}
		const previousConfig = state.config;
		state.config = nextConfig;
		onConfigApplied?.(nextConfig, ctx, previousConfig);
		syncAdapter(pi, ctx, state);
		return true;
	}

	const voiceControls = createCodexVoiceControls({ pi, state, voice, lanVoice });

	async function openSettings(ctx: ExtensionContext, tab: SettingsTab): Promise<void> {
		if (!ctx.hasUI) {
			if (tab === "usage") {
				const { fetchCodexUsage, formatCodexUsage } = await import("./usage.ts");
				try {
					ctx.ui.notify(formatCodexUsage(await fetchCodexUsage(ctx)), "info");
				} catch (error) {
					ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				}
				return;
			}
			ctx.ui.notify(formatCodexSettings(state.config), "info");
			return;
		}
		await openCodexSettingsScreen(ctx, {
			initialConfig: state.config,
			initialTab: tab,
			onChange: (config) => saveAndApply(ctx, config),
			lanVoiceServer: {
				status: () => lanVoice.status(),
				setEnabled: (enabled) => setLanVoiceServerEnabled(lanVoice, enabled, ctx),
			},
		});
	}

	pi.registerCommand("codex", {
		description: "Configure Codex adapter settings",
		getArgumentCompletions: (prefix) =>
			CODEX_COMMAND_COMPLETIONS.filter((item) => item.startsWith(prefix.trim().toLowerCase())).map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			state.config = readCodexConversionConfig();
			const arg = args.trim().toLowerCase();

			if (arg === "voice realtime" || arg === "voice dictation") {
				if (ctx.mode !== "tui") { ctx.ui.notify("Codex voice requires interactive TUI mode", "error"); return; }
				await ctx.waitForIdle();
				await voiceControls.start(arg === "voice dictation" ? "dictation" : "realtime", ctx);
				return;
			}
			if (arg === "voice stop") {
				if (ctx.mode !== "tui") { ctx.ui.notify("Codex voice requires interactive TUI mode", "error"); return; }
				await voiceControls.stop(ctx);
				return;
			}
			if (arg === "voice mute") {
				if (ctx.mode !== "tui") { ctx.ui.notify("Codex voice requires interactive TUI mode", "error"); return; }
				voiceControls.toggleInputMute(ctx);
				return;
			}
			if (arg === "voice server") {
				if (ctx.mode !== "tui") { ctx.ui.notify("LAN voice server requires interactive TUI mode", "error"); return; }
				const enabled = !lanVoice.status().running;
				try {
					await lanVoice.setEnabled(enabled, ctx);
					if (!enabled) ctx.ui.notify("LAN voice server stopped", "info");
				} catch (error) {
					ctx.ui.notify(`Could not ${enabled ? "start" : "stop"} LAN voice: ${error instanceof Error ? error.message : String(error)}`, "error");
				}
				return;
			}

			const tab = arg ? parseSettingsTab(arg) : "adapter";
			if (tab) {
				await openSettings(ctx, tab);
				return;
			}
			ctx.ui.notify(CODEX_USAGE, "warning");
		},
	});
}

async function setLanVoiceServerEnabled(lanVoice: CodexLanVoiceServerController, enabled: boolean, ctx: ExtensionContext) {
	try {
		return await lanVoice.setEnabled(enabled, ctx);
	} catch (error) {
		ctx.ui.notify(`Could not ${enabled ? "start" : "stop"} LAN voice: ${error instanceof Error ? error.message : String(error)}`, "error");
		throw error;
	}
}

function formatAllProvidersMode(value: CodexConversionConfig["scope"]["allProviders"]): string {
	return value === "extras" ? "only extras" : value;
}

function formatCodexSettings(config: CodexConversionConfig): string {
	return `Codex settings: extension ${config.voiceFeaturesOnly ? "voice only" : "adapter and voice"}, providers ${formatAllProvidersMode(config.scope.allProviders)}, Rust binaries ${config.tools.customRustBinariesDir || "bundled"}, heavy prompt overwrite ${config.prompt.heavySystemPromptOverwrite ? "on" : "off"}, harness identifier ${config.openai.harnessIdentifierHeader ? "on" : "off"}, Code Mode ${config.beta.codeMode ? "on" : "off"}, Responses Lite ${config.beta.responsesLite ? "on" : "off"}, compaction V2 ${config.compaction.responsesCompaction ? "on" : "off"}, fast ${config.openai.fast ? "on" : "off"}, verbosity ${config.openai.verbosity}`;
}
