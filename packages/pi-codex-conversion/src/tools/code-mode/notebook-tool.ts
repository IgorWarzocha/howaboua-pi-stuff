import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { SharedCodeModeRuntime } from "./shared-runtime.ts";
import type { NotebookControlRequest, ToolExecutionContext } from "./types.ts";

const NOTEBOOK_PARAMETERS = Type.Object({
	action: StringEnum(["status", "list", "checkpoint", "save", "load", "release", "restart"]),
	query: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	names: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
});

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	pi.registerTool({
		name: "notebook",
		label: "Notebook",
		description: "Notebook lifecycle: status/list (optional query glob), checkpoint, save/load (name required), release (names required), or restart. Lexical release restarts the kernel, so runtime-only handles are not restored",
		promptSnippet: "Inspect or control notebook lifecycle",
		parameters: NOTEBOOK_PARAMETERS,
		async execute(_id, params, signal, _onUpdate, ctx) {
			const result = await runtime.controlNotebook(
				normalizeNotebookRequest(params),
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

function normalizeNotebookRequest(params: {
	action: string;
	query?: string | undefined;
	name?: string | undefined;
	names?: string[] | undefined;
}): NotebookControlRequest {
	if (params.action === "status" || params.action === "list") {
		if (params.name !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts query only`);
		return { action: params.action, ...(params.query === undefined ? {} : { query: params.query }) };
	}
	if (params.action === "save" || params.action === "load") {
		if (params.query !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts name only`);
		if (!params.name) throw new Error(`notebook ${params.action} requires name`);
		return { action: params.action, name: params.name };
	}
	if (params.action === "release") {
		if (params.query !== undefined || params.name !== undefined) throw new Error("notebook release accepts names only");
		if (!params.names?.length) throw new Error("notebook release requires at least one name");
		return { action: "release", names: [...new Set(params.names)] };
	}
	if (params.action !== "checkpoint" && params.action !== "restart") {
		throw new Error(`Unsupported notebook action: ${params.action}`);
	}
	if (params.query !== undefined || params.name !== undefined || params.names !== undefined) {
		throw new Error(`notebook ${params.action} accepts only action`);
	}
	return { action: params.action };
}
