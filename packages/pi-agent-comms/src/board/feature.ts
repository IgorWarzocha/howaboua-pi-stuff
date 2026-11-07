import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { FeatureSettings, OpenSettings } from "../settings-navigation.js";
import { acquireBoard } from "./runtime/index.js";

export async function createBoardFeature(
	pi: ExtensionAPI,
	openSettings: OpenSettings,
): Promise<FeatureSettings> {
	const board = await acquireBoard(pi);
	pi.registerCommand("board", {
		description: "Board settings; status, on|off [session|folder|global]",
		getArgumentCompletions(prefix) {
			const commands = ["settings", "status", "on", "off"];
			const scopes = ["session", "folder", "global"];
			const options = prefix.includes(" ")
				? ["on", "off"].flatMap((command) =>
						scopes.map((scope) => `${command} ${scope}`),
					)
				: commands;
			return options
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ label: value, value }));
		},
		async handler(args, ctx) {
			if (!args.trim() || args.trim() === "settings")
				return openSettings(ctx, "board");
			const [command = "", scope = "session", ...extra] = args
				.trim()
				.split(/\s+/);
			if (
				(command === "on" || command === "off") &&
				(scope === "session" || scope === "folder" || scope === "global") &&
				!extra.length
			) {
				try {
					await board.setSetting(ctx, scope, command === "on");
					ctx.ui.notify(board.status(ctx), "info");
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			if (args.trim() === "status") {
				ctx.ui.notify(board.status(ctx), "info");
				return;
			}
			if (command) {
				ctx.ui.notify(
					"Use /board, /board settings, /board status or /board on|off [session|folder|global]",
					"warning",
				);
				return;
			}
		},
	});
	return {
		async openSettings(ctx) {
			const { openBoardSettings } = await import("./settings/panel.js");
			return openBoardSettings(pi, ctx, board);
		},
	};
}
