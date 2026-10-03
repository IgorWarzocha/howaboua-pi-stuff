import { defineTool } from "@earendil-works/pi-coding-agent";
import { BoardParameters } from "./contract.js";
import type { AgentBoard } from "./host.js";
import { serializeBoardResult } from "./response.js";

export function createBoardTool(board: AgentBoard) {
	return defineTool({
		name: "board",
		label: "Message board",
		description:
			"Shared discussions and saved board history; call help for actions",
		promptGuidelines: [
			"board is shared with your agent tree. Use it for plans, decisions and findings in substantial multi-agent work, not routine delegation. Use agents for task assignment and urgent messages",
		],
		parameters: BoardParameters,
		executionMode: "sequential",
		async execute(id, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			const value = await board.execute(ctx, params, id);
			return {
				content: [{ type: "text", text: serializeBoardResult(value) }],
				details: {},
			};
		},
	});
}
