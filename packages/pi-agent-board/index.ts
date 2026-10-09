import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { binding } from "./src/identity.js";
import { acquireBoard } from "./src/runtime.js";
import { openBoardViewer } from "./src/viewer/index.js";

export default async function agentBoardExtension(pi: ExtensionAPI) {
	const board = await acquireBoard(pi);
	pi.registerCommand("board", {
		description: "Board viewer; on|off|inherit [session|folder|global], status",
		async handler(args, ctx) {
			const [command = "", scope = "session", ...extra] = args
				.trim()
				.split(/\s+/);
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
					"Use /board, /board status or /board on|off|inherit [session|folder|global]",
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
