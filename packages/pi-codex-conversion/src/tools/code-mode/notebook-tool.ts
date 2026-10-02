import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import { canExecuteNotebookControlInsideExec } from "../notebook-mode/control-contract.ts";
import type { SharedCodeModeRuntime } from "./shared-runtime.ts";
import { notebookRenderers } from "./notebook-rendering.ts";
import type {
	NotebookControlRequest,
	NotebookControlResult,
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "./types.ts";

const NOTEBOOK_ACTION_PARAMETERS = Type.Union([
	Type.Object({
		action: StringEnum(["status", "list"]),
		query: Type.Optional(Type.String()),
	}, { additionalProperties: false }),
	Type.Object({
		action: StringEnum(["checkpoint", "restart", "diagnostics", "reset"]),
	}, { additionalProperties: false }),
	Type.Object({
		action: StringEnum(["save", "load"]),
		name: Type.String(),
	}, { additionalProperties: false }),
	Type.Object({
		action: Type.Literal("pin"),
		names: Type.Array(Type.String(), { minItems: 1 }),
		hook: Type.Optional(Type.Union([StringEnum(["startup", "tool_result"]), Type.Literal(false)], {
			description: "Await self-contained fn(event); tool_result gets {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger; false removes hook",
		})),
	}, { additionalProperties: false }),
	Type.Object({
		action: StringEnum(["unpin", "release"]),
		names: Type.Array(Type.String(), { minItems: 1 }),
	}, { additionalProperties: false }),
	Type.Object({
		action: Type.Literal("prune"),
		query: Type.String(),
	}, { additionalProperties: false }),
]);

export const NOTEBOOK_PARAMETERS = Type.Object({
	input: Type.String({ description: "help or JSON action object" }),
}, { additionalProperties: false });

const NOTEBOOK_DESCRIPTION = "Control persistent notebook state; status queries memory/bindings by glob; prune removes unpinned matches; list/save/load manage profiles";

const NOTEBOOK_HELP = `Call notebook with {"input":"help"} or {"input":"<JSON action object>"}.
Example: {"input":"{\\"action\\":\\"status\\",\\"query\\":\\"*\\"}"}
Action objects accept only the fields shown below; ? means optional.

{"action":"status","query"?:string}  Memory, checkpoint and retained-state summary; query inspects matching live bindings
{"action":"list","query"?:string}  List saved profiles, optionally filtered by name
{"action":"checkpoint"}  Persist current serializable state
{"action":"save","name":string}  Save current state as a named profile
{"action":"load","name":string}  Load a profile by value without replaying cells; release or rename colliding bindings first
{"action":"pin","names":string[],"hook"?:"startup"|"tool_result"|false}  Promote bindings to durable project state and protect from release/prune; omit hook to preserve it, false removes it
{"action":"unpin","names":string[]}  Remove pin protection and hooks, keeping bindings
{"action":"release","names":string[]}  Dispose and remove selected unpinned bindings; unpin protected bindings first
{"action":"prune","query":string}  Release unpinned bindings matching an explicit glob; pinned matches survive
{"action":"restart"}  Stop any active cell and restore the last completed checkpoint
{"action":"diagnostics"}  Check historical cells and runtime health without executing them
{"action":"reset"}  Stop any active cell and discard the session checkpoint; durable project state, saved notebook and named profiles survive

query uses case-insensitive * and ? globs. prune requires a nonempty query. names must be a nonempty array of binding-name strings. pin/release require existing JavaScript identifiers. Profile names: 1-64 letters, numbers, dots, underscores or hyphens, starting with a letter or number.

Hooks must be self-contained fn(event), awaited when invoked. startup gets {type:"startup"} once per fresh kernel after restoration, not when pinned; Pi tools cannot run during startup. tool_result gets {type:"tool_result",toolName,input,status:"success"|"error",result?,error?} after nested tool settlement; handlers are awaited in name order and their tool calls do not retrigger hooks. Recreate imports and live handles inside the function. Startup failures block execution; unpin remains available. External side effects are not rolled back.

Run management calls after exec returns. Inside exec, the existing tools.notebook({action,...}) supports status without query, list and diagnostics only. A blocked call returns the top-level retry. release/prune may restart the kernel for lexical bindings, clearing runtime-only handles. Inspect reported cleanup failures and restore notices. For failed state/helpers, diagnose, repair or prune, then verify recovery. restart restores completed state; reset discards only session state.`;

type NotebookToolParameters = {
	action: string;
	query?: string | undefined;
	name?: string | undefined;
	names?: string[] | undefined;
	hook?: string | false | undefined;
};

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	const constrainedSampling = getExperimentalToolSampling("notebook");
	pi.registerTool({
		name: "notebook",
		exposure: "model-only",
		label: "Notebook",
		description: "Manage persistent notebook state",
		parameters: NOTEBOOK_PARAMETERS,
		...notebookRenderers,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (params.input === "help") return {
				content: [{ type: "text", text: NOTEBOOK_HELP }],
				details: { action: "help" },
			};
			let action: unknown;
			try {
				action = JSON.parse(params.input);
			} catch (error) {
				throw new Error('notebook input must be help or a JSON action object; call notebook with {"input":"help"}', { cause: error });
			}
			if (!Check(NOTEBOOK_ACTION_PARAMETERS, action)) {
				throw new Error('Invalid notebook action arguments; call notebook with {"input":"help"}');
			}
			const result = await executeNotebookControl(runtime, action, {
				cwd: ctx.cwd,
				extensionContext: ctx,
			}, signal);
			return {
				content: [{ type: "text", text: result.message }],
				details: result.details,
			};
		},
	} satisfies ToolDefinition<typeof NOTEBOOK_PARAMETERS>);
}

export function createNotebookControlProxy(
	runtime: SharedCodeModeRuntime,
): ProgrammaticCodeModeToolDefinition {
	return {
		name: "notebook",
		usage: "await tools.notebook({ action, query?, name?, names?, hook? })",
		description: NOTEBOOK_DESCRIPTION,
		deferLoading: true,
		kind: "function",
		inputSchema: NOTEBOOK_ACTION_PARAMETERS,
		invoke: (input, context, signal) =>
			executeNotebookExecControl(runtime, input as NotebookToolParameters, context, signal),
	};
}

export async function executeNotebookControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	return executeNormalizedNotebookControl(runtime, normalizeNotebookRequest(params), context, signal);
}

export async function executeNotebookExecControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	const request = normalizeNotebookRequest(params);
	if (!canExecuteNotebookControlInsideExec(request))
		return {
			message: `Notebook ${request.action} was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify({ input: JSON.stringify(request) })}.`,
			details: { notRun: true, action: request.action, retry: request },
		};
	return executeNormalizedNotebookControl(runtime, request, context, signal);
}

function executeNormalizedNotebookControl(
	runtime: SharedCodeModeRuntime,
	request: NotebookControlRequest,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	return runtime.controlNotebook(request, context, signal);
}

export function normalizeNotebookRequest(params: NotebookToolParameters): NotebookControlRequest {
	params = {
		action: params.action,
		...(params.query == null ? {} : { query: params.query }),
		...(params.name == null ? {} : { name: params.name }),
		...(params.names == null ? {} : { names: params.names }),
		...(params.hook == null ? {} : { hook: params.hook }),
	};
	if (params.hook !== undefined && (params.action !== "pin" || params.hook !== false && params.hook !== "startup" && params.hook !== "tool_result")) {
		throw new Error("notebook hook requires pin and startup, tool_result, or false");
	}
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
		return { action: params.action, names: [...new Set(params.names)], ...(params.action === "pin" && params.hook !== undefined ? { hook: params.hook } : {}) };
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
