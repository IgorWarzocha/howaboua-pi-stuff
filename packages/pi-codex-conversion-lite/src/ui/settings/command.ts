import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { readCodexConversionConfig, writeCodexConversionConfig } from "../../adapter/activation/config-store.ts";
import { syncAdapter } from "../../adapter/activation/activation.ts";
import type { AdapterState } from "../../adapter/activation/state.ts";
import type { CodexVoiceController } from "../../voice/controller.ts";
import { createCodexVoiceControls } from "../../voice/controls.ts";
import { SETTINGS_TABS, parseSettingsTab, type SettingsTab } from "./tabs.ts";
import { openCodexSettingsScreen } from "./screen.ts";

const VOICE_ACTIONS = ["voice realtime", "voice dictation", "voice stop"] as const;
const CODEX_COMMAND_COMPLETIONS = [...SETTINGS_TABS.map(({ id }) => id), ...VOICE_ACTIONS];
const CODEX_USAGE = "Usage: /codex [adapter|tools|openai|display|voice|usage|about]";

export function registerCodexCommand(
	pi: ExtensionAPI,
	state: AdapterState,
	voice: CodexVoiceController,
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

	const voiceControls = createCodexVoiceControls({ pi, state, voice, saveAndApply });

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

			const tab = arg ? parseSettingsTab(arg) : "adapter";
			if (tab) {
				await openSettings(ctx, tab);
				return;
			}
			ctx.ui.notify(CODEX_USAGE, "warning");
		},
	});
}

function formatAllProvidersMode(value: CodexConversionConfig["scope"]["allProviders"]): string {
	return value === "extras" ? "only extras" : value;
}

function formatCodexSettings(config: CodexConversionConfig): string {
	return `Codex settings: extension ${config.voiceFeaturesOnly ? "voice only" : "adapter and voice"}, providers ${formatAllProvidersMode(config.scope.allProviders)}, Rust binaries ${config.tools.customRustBinariesDir || "bundled"}, heavy prompt overwrite ${config.prompt.heavySystemPromptOverwrite ? "on" : "off"}, harness identifier ${config.openai.harnessIdentifierHeader ? "on" : "off"}, Code Mode ${config.beta.codeMode ? "on" : "off"}, Responses Lite ${config.beta.responsesLite ? "on" : "off"}, compaction V2 ${config.compaction.responsesCompaction ? "on" : "off"}, fast ${config.openai.fast ? "on" : "off"}, verbosity ${config.openai.verbosity}`;
}
