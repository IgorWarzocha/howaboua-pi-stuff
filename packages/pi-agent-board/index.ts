import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	readBoardSummaryConfig,
	resolveBoardSummaryModel,
	writeBoardSummarySelection,
} from "./src/config.js";
import { requestBoardConsolidation } from "./src/consolidation.js";
import { binding } from "./src/identity.js";
import { acquireBoard } from "./src/runtime.js";
import { openBoardViewer } from "./src/viewer/index.js";

export default async function agentBoardExtension(pi: ExtensionAPI) {
	const board = await acquireBoard(pi);
	pi.registerCommand("board", {
		description:
			"Board viewer; settings, status, on|off [session|folder|global]",
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
			if (args.trim() === "settings") {
				if (!ctx.hasUI) {
					ctx.ui.notify(
						"Use /board settings in an interactive session",
						"warning",
					);
					return;
				}
				try {
					if (binding(ctx).upstream)
						throw new Error("Change Board settings in the owning root session");
					const sessionId = ctx.sessionManager.getSessionId();
					const consolidate =
						"Consolidate one-off threads (sends a prompt to this session's agent)";
					const setting = await ctx.ui.select("Board settings and actions", [
						"Automatic summaries",
						"Summary model",
						consolidate,
					]);
					if (setting === consolidate) {
						if (ctx.sessionManager.getSessionId() !== sessionId)
							throw new Error("Session changed; reopen Board settings");
						requestBoardConsolidation(pi, ctx);
						return;
					}
					if (!setting) return;
					const config = readBoardSummaryConfig(ctx.cwd);
					if (setting === "Automatic summaries") {
						const selected = await ctx.ui.select(
							`Automatic summaries: ${config.automatic ? "on" : "off"}. Summarise on closure? Uses model quota.`,
							["Off", "On"],
						);
						if (selected !== "Off" && selected !== "On") return;
						board.setAutomaticSummaries(ctx, selected === "On");
						ctx.ui.notify(
							`Automatic board summaries: ${selected.toLowerCase()}.`,
							"info",
						);
						return;
					}
					if (setting !== "Summary model") return;
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
