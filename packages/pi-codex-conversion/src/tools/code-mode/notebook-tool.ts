import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { SharedCodeModeRuntime } from "./shared-runtime.ts";
import type { NotebookControlRequest, ToolExecutionContext } from "./types.ts";

const NOTEBOOK_PARAMETERS = Type.Union([
	Type.Object({
		action: Type.Literal("status"),
		query: Type.Optional(Type.String({ description: "Glob selecting top-level binding names to inspect" })),
	}),
	Type.Object({ action: Type.Literal("checkpoint") }),
	Type.Object({
		action: Type.Literal("release"),
		names: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }),
	}),
	Type.Object({ action: Type.Literal("restart") }),
]);

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	pi.registerTool({
		name: "notebook",
		label: "Notebook",
		description: "Inspect or control the persistent notebook. Checkpoint durable state, release named bindings and standard disposable resources, or restart the kernel from the last completed checkpoint",
		promptSnippet: "Inspect or control notebook lifecycle",
		parameters: NOTEBOOK_PARAMETERS,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const result = await runtime.controlNotebook(
				params as NotebookControlRequest,
				{ cwd: ctx.cwd, extensionContext: ctx } as ToolExecutionContext,
				signal,
			);
			return {
				content: [{ type: "text", text: result.message }],
				details: result.details,
			};
		},
	} satisfies ToolDefinition<typeof NOTEBOOK_PARAMETERS>);
}
