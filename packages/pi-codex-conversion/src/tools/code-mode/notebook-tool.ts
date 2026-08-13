import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { SharedCodeModeRuntime } from "./shared-runtime.ts";
import type { NotebookControlRequest, ToolExecutionContext } from "./types.ts";

const NOTEBOOK_PARAMETERS = Type.Object({
	action: StringEnum(["status", "list", "checkpoint", "save", "load", "pin", "unpin", "release", "prune", "restart", "diagnostics", "reset"]),
	query: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	names: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
});

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	pi.registerTool({
		name: "notebook",
		label: "Notebook",
		description: "Persistent notebook state/recovery: status shows binding age/size/pins and filters by query glob; list filters profiles; checkpoint; save/load name; pin/unpin/release names; prune unpinned bindings by query; restart; diagnostics checks the journal; reset clears live/durable state but keeps journal/profiles",
		promptSnippet: "Inspect, recover, or control notebook state",
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
	if (params.action === "release" || params.action === "pin" || params.action === "unpin") {
		if (params.query !== undefined || params.name !== undefined) throw new Error(`notebook ${params.action} accepts names only`);
		if (!params.names?.length) throw new Error(`notebook ${params.action} requires at least one name`);
		return { action: params.action, names: [...new Set(params.names)] };
	}
	if (params.action === "prune") {
		if (params.name !== undefined || params.names !== undefined) throw new Error("notebook prune accepts query only");
		if (!params.query) throw new Error("notebook prune requires query");
		return { action: "prune", query: params.query };
	}
	if (params.action !== "checkpoint" && params.action !== "restart" && params.action !== "diagnostics" && params.action !== "reset") {
		throw new Error(`Unsupported notebook action: ${params.action}`);
	}
	if (params.query !== undefined || params.name !== undefined || params.names !== undefined) {
		throw new Error(`notebook ${params.action} accepts only action`);
	}
	return { action: params.action };
}
