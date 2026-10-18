import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	readBoardSummaryConfig,
	resolveBoardSummaryModel,
	writeBoardSummarySelection,
} from "./src/config.js";
import { binding } from "./src/identity.js";
import { acquireBoard } from "./src/runtime.js";
import { openBoardViewer } from "./src/viewer/index.js";

export default async function agentBoardExtension(pi: ExtensionAPI) {
	const board = await acquireBoard(pi);
	pi.registerCommand("board", {
		description:
			"Board viewer; settings, summarize <thread-id>, on|off|inherit [session|folder|global], status",
		async handler(args, ctx) {
			if (args.trim() === "settings") {
				if (!ctx.hasUI) {
					ctx.ui.notify(
						"Use /board settings in an interactive session",
						"warning",
					);
					return;
				}
				try {
					const config = readBoardSummaryConfig(ctx.cwd);
					const selected = await ctx.ui.select(
						`Board summary model (global; current: ${config.selection === "luna" ? "Luna" : "Custom"})`,
						["Luna", "Custom"],
					);
					if (selected !== "Luna" && selected !== "Custom") return;
					writeBoardSummarySelection(
						ctx.cwd,
						selected === "Luna" ? "luna" : "custom",
					);
					try {
						resolveBoardSummaryModel(ctx.cwd);
					} catch (error) {
						ctx.ui.notify(
							`Custom selected. ${error instanceof Error ? error.message : String(error)}`,
							"warning",
						);
						return;
					}
					ctx.ui.notify(
						selected === "Custom"
							? `Board summary model: Custom. Edit board.summary.custom in ${config.path}: set provider, model and reasoning.`
							: "Board summary model: Luna (high).",
						"info",
					);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			const [command = "", scope = "session", ...extra] = args
				.trim()
				.split(/\s+/);
			if (command === "summarize" && !extra.length) {
				try {
					board.summarize(ctx, scope);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			if (
				(command === "on" || command === "off" || command === "inherit") &&
				(scope === "session" || scope === "folder" || scope === "global") &&
				!extra.length
			) {
				try {
					if (command === "inherit" && scope === "global")
						throw new Error("Global enablement must be on or off");
					await board.setSetting(
						ctx,
						scope,
						command === "inherit" ? undefined : command === "on",
					);
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
					"Use /board, /board settings, /board summarize <thread-id>, /board status or /board on|off|inherit [session|folder|global]",
					"warning",
				);
				return;
			}
			await openBoardViewer(pi, ctx, (context, sessionName) => {
				const own = binding(context);
				if (own.upstream)
					throw new Error(
						"Open /board in the owning root session to view this shared board",
					);
				return {
					sessionId: own.sessionId,
					sessionName: sessionName ?? null,
					boardId: own.boardId,
					folder: own.ownerFolder,
					databasePath: own.databasePath,
				};
			});
		},
	});
}
