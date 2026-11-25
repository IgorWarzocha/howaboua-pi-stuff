import { defineTool } from "@earendil-works/pi-coding-agent";
import type { Static } from "@earendil-works/pi-schema";
import { BoardParameters, parseBoardRequest } from "./contract.js";
import { serializeBoardToolResult } from "./response.js";
import type { BoardRuntime } from "./runtime/coordinator.js";

export function createBoardTool(board: BoardRuntime) {
	return defineTool({
		name: "board",
		label: "Message board",
		description: "Shared discussions and saved board history",
		parameters: BoardParameters,
		prepareArguments: parseBoardRequest,
		executionMode: "sequential",
		async execute(
			id,
			params: Static<typeof BoardParameters>,
			signal,
			_onUpdate,
			ctx,
		) {
			signal?.throwIfAborted();
			const value = await board.execute(ctx, params, id);
			return {
				content: [
					{
						type: "text",
						text: serializeBoardToolResult(value, params.action),
					},
				],
				details: {},
			};
		},
	});
}
