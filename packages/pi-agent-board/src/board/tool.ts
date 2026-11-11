import { defineTool } from "@earendil-works/pi-coding-agent";
import { compile } from "@earendil-works/pi-schema";
import { BoardParameters } from "./contract.js";
import { serializeBoardToolResult } from "./response.js";
import type { BoardRuntime } from "./runtime/coordinator.js";

const boardParametersValidator = compile(BoardParameters);

export function createBoardTool(board: BoardRuntime) {
	return defineTool({
		name: "board",
		label: "Message board",
		description: "Shared discussions and saved board history",
		parameters: BoardParameters,
		executionMode: "sequential",
		async execute(id, params, signal, _onUpdate, ctx) {
			signal?.throwIfAborted();
			if (!boardParametersValidator.check(params))
				throw new Error("Invalid board request; call board help");
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
