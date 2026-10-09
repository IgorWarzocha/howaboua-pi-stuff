import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { binding } from "./src/identity.js";
import { acquireBoard } from "./src/runtime.js";
import { openBoardViewer } from "./src/viewer/index.js";

export default async function agentBoardExtension(pi: ExtensionAPI) {
	const board = await acquireBoard(pi, { standalone: true });
	pi.registerCommand("board", {
		description:
			"Open the board viewer; on|off|status controls this session's board",
		async handler(args, ctx) {
			const command = args.trim();
			if (command === "on" || command === "off") {
				try {
					await board.setSetting(ctx, "session", command === "on");
					ctx.ui.notify(board.status(ctx), "info");
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error ? error.message : String(error),
						"error",
					);
				}
				return;
			}
			if (command === "status") {
				ctx.ui.notify(board.status(ctx), "info");
				return;
			}
			if (command) {
				ctx.ui.notify(
					"Use /board, /board on, /board off or /board status",
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
