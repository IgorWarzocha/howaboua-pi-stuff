import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	normalizeCodexVerbosity,
	readCodexConversionConfig,
	writeCodexConversionConfig,
	type CodexConversionConfig,
} from "../adapter/config.ts";
import { syncAdapter } from "../adapter/activation.ts";
import type { AdapterState } from "../adapter/state.ts";
import { openCodexSettingsScreen } from "./ui.ts";
import { fetchCodexUsage, formatCodexUsage } from "./usage.ts";
import type { BackgroundBashWidgetState } from "../tools/background-bash-widget.ts";
import { renderBackgroundBashWidget } from "../tools/background-bash-widget.ts";
import type { ExecSessionManager } from "../tools/exec-session-manager.ts";

const CODEX_COMMAND_COMPLETIONS = ["all", "status", "fast", "search", "image", "compact", "usage", "ps", "low", "medium", "high"] as const;
const CODEX_USAGE = "Usage: /codex, /codex all, /codex status, /codex fast, /codex search, /codex image, /codex compact, /codex usage, /codex ps, /codex low|medium|high";

export function registerCodexCommand(
	pi: ExtensionAPI,
	state: AdapterState,
	onConfigApplied?: (config: CodexConversionConfig) => void,
	backgroundShells?: { sessions: ExecSessionManager; widget: BackgroundBashWidgetState } | undefined,
): void {
	function saveAndApply(ctx: ExtensionContext, nextConfig: CodexConversionConfig): boolean {
		const writeResult = writeCodexConversionConfig(nextConfig);
		if (!writeResult.ok) {
			ctx.ui.notify(`Failed to save Codex settings: ${writeResult.error}`, "error");
			return false;
		}
		state.config = nextConfig;
		onConfigApplied?.(nextConfig);
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
				if (!state.config.backgroundShellWidget) {
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
			if (arg === "usage") {
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
					initialTab: "compaction",
					onChange: (config) => saveAndApply(ctx, config),
				});
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

function getCommandConfigUpdate(arg: string, config: CodexConversionConfig): CodexConversionConfig | undefined {
	if (arg === "fast") return { ...config, fast: !config.fast };
	if (arg === "all") return { ...config, useOnAllModels: !config.useOnAllModels };
	if (arg === "status") return { ...config, statusLine: !config.statusLine };
	if (arg === "search") return { ...config, webSearch: !config.webSearch };
	if (arg === "image") return { ...config, imageGeneration: !config.imageGeneration };
	const verbosity = normalizeCodexVerbosity(arg);
	return verbosity ? { ...config, verbosity } : undefined;
}

function formatCodexSettings(config: CodexConversionConfig): string {
	return `Codex settings: all models ${config.useOnAllModels ? "on" : "off"}, codex proxy ${config.useAdapterProviders ? "on" : "off"}${config.adapterProviders.length > 0 ? ` (${config.adapterProviders.join(", ")})` : ""}, proxy tools ${config.adapterProviderCodexTools ? "on" : "off"}, statusline ${config.statusLine ? "on" : "off"}, background shells widget ${config.backgroundShellWidget ? "on" : "off"}, fast ${config.fast ? "on" : "off"}, cached websocket upgrade ${config.forceCachedWebSockets === false ? "off" : "on"}, web search ${config.webSearch ? "on" : "off"}, image generation ${config.imageGeneration ? "on" : "off"}, responses compaction ${(config.responsesCompaction ?? false) ? "on" : "off"} (${config.compactionModel}/${config.compactionReasoning}), verbosity ${config.verbosity}`;
}
