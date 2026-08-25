import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import {
	clearFolderCodexConversionConfig,
	getCodexConversionConfigPath,
	getProjectCodexConversionConfigPath,
	hasFolderCodexConversionConfig,
	materializeFolderCodexConversionConfig,
	readCodexConversionConfig,
	readEffectiveCodexConversionConfig,
	readLayeredCodexConversionConfig,
	setGlobalCodexLunaCacheKeepalive,
	setProjectCodexCacheKeepalive,
	type CodexConversionConfigScope,
	writeCodexConversionConfig,
} from "../../adapter/activation/config-store.ts";
import { syncAdapter } from "../../adapter/activation/activation.ts";
import type { AdapterState } from "../../adapter/activation/state.ts";
import type { CodexVoiceController } from "../../voice/controller.ts";
import { createCodexVoiceControls } from "../../voice/controls.ts";
import type { CodexLanVoiceServerController } from "../../voice/lan/controller.ts";
import { ROUTABLE_SETTINGS_TABS, parseSettingsTab, type SettingsTab } from "./tabs.ts";
import { openCodexSettingsScreen } from "./screen.ts";

const VOICE_ACTIONS = ["voice realtime", "voice mute", "voice dictation", "voice stop", "voice server", "voice setup"] as const;
const CODEX_COMMAND_COMPLETIONS = [...ROUTABLE_SETTINGS_TABS.map(({ id }) => id), ...VOICE_ACTIONS];
const CODEX_USAGE = "Usage: /codex [tools|openai|display|voice [realtime|mute|dictation|stop|server|setup]|usage|about]";

export function registerCodexCommand(
	pi: ExtensionAPI,
	state: AdapterState,
	voice: CodexVoiceController,
	lanVoice: CodexLanVoiceServerController,
	onConfigApplied?: (config: CodexConversionConfig, ctx: ExtensionContext, previousConfig: CodexConversionConfig) => void,
): void {
	function effectiveConfig(ctx: ExtensionContext): CodexConversionConfig {
		return readEffectiveCodexConversionConfig({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
	}

	function applyEffectiveConfig(ctx: ExtensionContext, previousConfig: CodexConversionConfig): void {
		const config = effectiveConfig(ctx);
		state.config = config;
		state.executionMode = config.executionMode;
		onConfigApplied?.(config, ctx, previousConfig);
		syncAdapter(pi, ctx, state);
	}

	function saveAndApply(
		ctx: ExtensionContext,
		scope: CodexConversionConfigScope,
		nextConfig: CodexConversionConfig,
	): boolean {
		const path = scope === "folder"
			? getProjectCodexConversionConfigPath(ctx.cwd)
			: getCodexConversionConfigPath();
		const writeResult = writeCodexConversionConfig(nextConfig, path, scope === "folder");
		if (!writeResult.ok) {
			ctx.ui.notify(`Failed to save Codex settings: ${writeResult.error}`, "error");
			return false;
		}
		const previousConfig = state.config;
		applyEffectiveConfig(ctx, previousConfig);
		return true;
	}

	const voiceControls = createCodexVoiceControls({ pi, state, voice, lanVoice });

	async function openSettings(ctx: ExtensionContext, tab: SettingsTab): Promise<void> {
		if (!ctx.hasUI) {
			if (tab === "usage") {
				const [{ fetchCodexUsage }, { formatCodexUsage }] = await Promise.all([
					import("../../codex-usage/client.ts"),
					import("../../codex-usage/format.ts"),
				]);
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
		let configScope: CodexConversionConfigScope = hasFolderCodexConversionConfig(
			ctx.cwd,
			ctx.isProjectTrusted(),
		) ? "folder" : "global";
		if (configScope === "folder") {
			const materialized = materializeFolderCodexConversionConfig(ctx.cwd, true);
			if (!materialized.ok) {
				ctx.ui.notify(`Could not materialize folder Codex settings: ${materialized.error}`, "error");
				return;
			}
		}
		const readSelectedConfig = () => {
			const effective = effectiveConfig(ctx);
			const selected = configScope === "folder"
				? readLayeredCodexConversionConfig({ cwd: ctx.cwd, projectTrusted: true })
				: readCodexConversionConfig();
			return {
				...selected,
				openai: {
					...selected.openai,
					lunaCacheKeepaliveMinutes: effective.openai.lunaCacheKeepaliveMinutes,
					cacheKeepalive: effective.openai.cacheKeepalive,
				},
			};
		};
		await openCodexSettingsScreen(ctx, {
			initialConfig: readSelectedConfig(),
			initialTab: tab,
			onChange: (config) => saveAndApply(ctx, configScope, config),
			onGlobalLunaCacheKeepalive: (minutes) => {
				const result = setGlobalCodexLunaCacheKeepalive(minutes);
				if (!result.ok) {
					ctx.ui.notify(`Failed to save global Luna cache keepalive: ${result.error}`, "error");
					return undefined;
				}
				const previousConfig = state.config;
				applyEffectiveConfig(ctx, previousConfig);
				return readSelectedConfig();
			},
			onProjectCacheKeepalive: (enabled) => {
				const result = setProjectCodexCacheKeepalive(ctx.cwd, ctx.isProjectTrusted(), enabled);
				if (!result.ok) {
					ctx.ui.notify(`Failed to save project cache keepalive: ${result.error}`, "error");
					return undefined;
				}
				const previousConfig = state.config;
				applyEffectiveConfig(ctx, previousConfig);
				return readSelectedConfig();
			},
			configScope: {
				current: () => configScope,
				canUseFolder: ctx.isProjectTrusted(),
				path: () => configScope === "folder"
					? getProjectCodexConversionConfigPath(ctx.cwd)
					: getCodexConversionConfigPath(),
				reload: readSelectedConfig,
				set: (scope) => {
					const previousConfig = state.config;
					const result = scope === "folder"
						? materializeFolderCodexConversionConfig(ctx.cwd, ctx.isProjectTrusted())
						: clearFolderCodexConversionConfig(ctx.cwd, ctx.isProjectTrusted());
					if (!result.ok) {
						ctx.ui.notify(`Could not change Codex settings scope: ${result.error}`, "error");
						return undefined;
					}
					configScope = scope;
					applyEffectiveConfig(ctx, previousConfig);
					return readSelectedConfig();
				},
			},
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
			state.config = effectiveConfig(ctx);
			const arg = args.trim().toLowerCase();

			if (arg === "voice setup") {
				await ctx.waitForIdle();
				await voiceControls.setup(ctx);
				return;
			}

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
	return `Codex settings: extension ${config.voiceFeaturesOnly ? "voice only" : "adapter and voice"}, execution ${config.executionMode}, providers ${formatAllProvidersMode(config.scope.allProviders)}, Rust binaries ${config.tools.customRustBinariesDir || "bundled"}, heavy prompt overwrite ${config.prompt.heavySystemPromptOverwrite ? "on" : "off"}, harness identifier ${config.openai.harnessIdentifierHeader ? "on" : "off"}, Proxy Responses Lite ${config.openai.proxyResponsesLite ? "on" : "off"}, compaction V2 ${config.compaction.responsesCompaction ? "on" : "off"}, Luna cache keepalive ${config.openai.lunaCacheKeepaliveMinutes === 0 ? "off" : `${config.openai.lunaCacheKeepaliveMinutes} mins`}, Sol/Terra cache keepalive ${config.openai.cacheKeepalive ? "25 mins" : "off"}, cache diagnostics ${config.openai.cacheDiagnostics}, fast ${config.openai.fast ? "on" : "off"}, verbosity ${config.openai.verbosity}`;
}
