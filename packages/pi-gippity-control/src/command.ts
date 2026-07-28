import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "./config.ts";
import {
	readGippityControlConfig,
	writeGippityControlConfig,
} from "./config-store.ts";
import { openGippitySettings } from "./settings.ts";
import type { CodexVoiceControls } from "./voice/controls.ts";
import type { CodexLanVoiceServerController } from "./voice/lan/controller.ts";

const ACTIONS = ["realtime", "dictation", "stop", "server"] as const;

export function registerGippityCommand(options: {
	pi: ExtensionAPI;
	state: { config: GippityControlConfig };
	voiceControls: CodexVoiceControls;
	lanVoice: CodexLanVoiceServerController;
}): void {
	const { pi, state, voiceControls, lanVoice } = options;
	const save = (
		ctx: ExtensionContext,
		config: GippityControlConfig,
	): boolean => {
		const result = writeGippityControlConfig(config);
		if (!result.ok) {
			ctx.ui.notify(
				`Could not save GipPity settings: ${result.error}`,
				"error",
			);
			return false;
		}
		state.config = config;
		return true;
	};

	pi.registerCommand("gippity", {
		description: "Control GipPity voice and LAN remote",
		getArgumentCompletions: (prefix) =>
			ACTIONS.filter((action) =>
				action.startsWith(prefix.trim().toLowerCase()),
			).map((value) => ({ label: value, value })),
		handler: async (args, ctx) => {
			state.config = readGippityControlConfig();
			const action = args.trim().toLowerCase();
			if (!action) {
				if (!ctx.hasUI) {
					ctx.ui.notify(formatStatus(state.config, lanVoice), "info");
					return;
				}
				await openGippitySettings({
					ctx,
					initialConfig: state.config,
					lanVoice,
					onChange: (config) => save(ctx, config),
				});
				return;
			}
			if (!ACTIONS.includes(action as (typeof ACTIONS)[number])) {
				ctx.ui.notify(
					"Usage: /gippity [realtime|dictation|stop|server]",
					"warning",
				);
				return;
			}
			if (ctx.mode !== "tui") {
				ctx.ui.notify("GipPity requires interactive TUI mode", "error");
				return;
			}
			if (action === "realtime" || action === "dictation") {
				await ctx.waitForIdle();
				await voiceControls.start(action, ctx);
				return;
			}
			if (action === "stop") {
				await voiceControls.stop(ctx);
				return;
			}
			const enabled = !lanVoice.status().running;
			try {
				await lanVoice.setEnabled(enabled, ctx);
				if (!enabled) ctx.ui.notify("GipPity control server stopped", "info");
			} catch (error) {
				ctx.ui.notify(
					`Could not ${enabled ? "start" : "stop"} GipPity: ${error instanceof Error ? error.message : String(error)}`,
					"error",
				);
			}
		},
	});
}

function formatStatus(
	config: GippityControlConfig,
	lanVoice: CodexLanVoiceServerController,
): string {
	const server = lanVoice.status();
	return `GipPity: voice ${config.voice.v3Voice}, dictation ${config.voice.dictationShortcutMode}, server ${server.running ? server.urls.join(", ") : "off"}`;
}
