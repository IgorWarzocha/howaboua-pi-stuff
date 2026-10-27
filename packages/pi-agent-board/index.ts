import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { binding } from "./src/identity.js";
import { acquireBoard } from "./src/runtime/index.js";
import { openBoardSettings } from "./src/settings/panel.js";
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
			if (args.trim() === "settings") return openBoardSettings(pi, ctx, board);
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
