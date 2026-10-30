import { notebookHelpForMode } from "./notebook-help.ts";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { Check } from "typebox/value";
import { registerGptPromptMode, type GptPromptModeRegistration } from "../../prompt-mode.ts";
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

const PIN_PARAMETERS = Type.Object({
	action: Type.Literal("pin"),
	names: Type.Array(Type.String(), { minItems: 1 }),
	hook: Type.Optional(Type.Union([StringEnum(["startup", "tool_result"]), Type.Literal(false)], {
		description: "Await self-contained fn(event); tool_result gets {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger; false removes hook",
	})),
}, { additionalProperties: false });

function notebookActionParameters(allowCheckpoint = false) {
	return Type.Union([
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
		allowCheckpoint ? Type.Object({ ...PIN_PARAMETERS.properties, checkpoint: Type.Optional(Type.Object({ snapshot: Type.String(), restore: Type.String() }, { additionalProperties: false })) }, { additionalProperties: false }) : PIN_PARAMETERS,
		Type.Object({
			action: StringEnum(["unpin", "release"]),
			names: Type.Array(Type.String(), { minItems: 1 }),
		}, { additionalProperties: false }),
		Type.Object({
			action: Type.Literal("prune"),
			query: Type.String(),
		}, { additionalProperties: false }),
	]);
}

const JS_ACTION_PARAMETERS = Type.Union([
	Type.Object({ action: Type.Literal("hook"), name: Type.String(), event: Type.Union([StringEnum(["startup", "tool_result"]), Type.Literal(false)]) }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["status", "list"]), query: Type.Optional(Type.String()) }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["checkpoint", "restart", "diagnostics", "reset"]) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("save"), name: Type.String(), names: Type.Optional(Type.Array(Type.String(), { minItems: 1 })) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("load"), name: Type.String() }, { additionalProperties: false }),
	Type.Object({ action: StringEnum(["pin", "unpin", "release"]), names: Type.Array(Type.String(), { minItems: 1 }) }, { additionalProperties: false }),
	Type.Object({ action: Type.Literal("prune"), query: Type.String() }, { additionalProperties: false }),
]);

function actionParameters(kind: string) {
	return kind === "js" ? JS_ACTION_PARAMETERS : kind === "ts" ? TS_ACTION_PARAMETERS : NOTEBOOK_ACTION_PARAMETERS;
}

const NOTEBOOK_ACTION_PARAMETERS = notebookActionParameters();
const TS_ACTION_PARAMETERS = notebookActionParameters(true);

export const NOTEBOOK_PARAMETERS = Type.Object({
	input: Type.Optional(Type.String({ description: 'help or JSON, e.g. {"action":"status"}; not a bare action name' })),
}, { additionalProperties: false });

const NOTEBOOK_DISCOVERY_PARAMETERS = Type.Object({
	action: Type.Optional(Type.Literal("help")),
}, { additionalProperties: false });

const NOTEBOOK_DESCRIPTION = "Manage persistent notebook state";

const notebookPromptModes = new WeakMap<SharedCodeModeRuntime, GptPromptModeRegistration>();

function notebookHelp(runtime: SharedCodeModeRuntime, context: unknown): string {
	return notebookHelpForMode(runtime.executionKind(context), notebookPromptModes.get(runtime)?.active === true);
}

type NotebookToolParameters = {
	action: string;
	query?: string | undefined;
	name?: string | undefined;
	names?: string[] | undefined;
	hook?: string | false | undefined;
	event?: string | false | undefined;
	checkpoint?: { snapshot: string; restore: string } | undefined;
};

export function registerNotebookTool(pi: ExtensionAPI, runtime: SharedCodeModeRuntime): void {
	notebookPromptModes.set(runtime, registerGptPromptMode(pi, () => undefined));
	const constrainedSampling = getExperimentalToolSampling("notebook");
	pi.registerTool({
		name: "notebook",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Notebook",
		description: "Manage persistent notebook state",
		parameters: NOTEBOOK_PARAMETERS,
		prepareArguments(args) {
			let prepared = args;
			if (typeof prepared === "string") prepared = { input: prepared };
			if (prepared && typeof prepared === "object" && !Array.isArray(prepared)) {
				if ("action" in prepared && !("input" in prepared)) prepared = { input: JSON.stringify(prepared) };
				else if ("input" in prepared && prepared.input !== null && typeof prepared.input === "object")
					prepared = { ...prepared, input: JSON.stringify(prepared.input) };
			}
			if (!Check(NOTEBOOK_PARAMETERS, prepared)) throw new Error('Invalid notebook arguments; call notebook({})');
			return prepared;
		},
		...notebookRenderers,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(_id, params, signal, _onUpdate, ctx) {
			if (params.input === undefined || params.input === "help") return {
				content: [{ type: "text", text: notebookHelp(runtime, ctx) }],
				details: { action: "help" },
			};
			let action: unknown;
			try {
				action = JSON.parse(params.input);
			} catch (error) {
				throw new Error('notebook input must be help or a JSON action object; call notebook({})', { cause: error });
			}
			if (Check(NOTEBOOK_DISCOVERY_PARAMETERS, action)) return {
				content: [{ type: "text", text: notebookHelp(runtime, ctx) }],
				details: { action: "help" },
			};
			if (!Check(actionParameters(runtime.executionKind(ctx)), action)) {
				throw new Error('Invalid notebook action arguments; call notebook({})');
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
	kind: "code" | "notebook" | "ts" | "js" = "notebook",
): ProgrammaticCodeModeToolDefinition {
	return {
		name: "notebook",
		usage: "await tools.notebook()",
		discovery: "help",
		description: NOTEBOOK_DESCRIPTION,
		deferLoading: true,
		kind: "function",
		inputSchema: Type.Union([NOTEBOOK_DISCOVERY_PARAMETERS, actionParameters(kind)]),
		invoke: (input, context, signal) => {
			if (input === undefined || Check(NOTEBOOK_DISCOVERY_PARAMETERS, input))
				return Promise.resolve({ message: notebookHelp(runtime, context.extensionContext), details: { action: "help" } });
			return executeNotebookExecControl(runtime, input as NotebookToolParameters, context, signal);
		},
	};
}

export async function executeNotebookControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	validateModeRequest(runtime, params, context);
	return executeNormalizedNotebookControl(runtime, normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts", runtime.executionKind(context.extensionContext) === "js"), context, signal);
}

export async function executeNotebookExecControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	validateModeRequest(runtime, params, context);
	const request = normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts", runtime.executionKind(context.extensionContext) === "js");
	if (!canExecuteNotebookControlInsideExec(request))
		return {
			message: `Notebook ${request.action} was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify({ input: JSON.stringify(request) })}.`,
			details: { notRun: true, action: request.action, retry: request },
		};
	return executeNormalizedNotebookControl(runtime, request, context, signal);
}

function validateModeRequest(runtime: SharedCodeModeRuntime, params: NotebookToolParameters, context: ToolExecutionContext): void {
	if (runtime.executionKind(context.extensionContext) === "js" && !Check(JS_ACTION_PARAMETERS, params))
		throw new Error("Invalid JS Notebook action; call notebook({}) for supported controls");
}

function executeNormalizedNotebookControl(
	runtime: SharedCodeModeRuntime,
	request: NotebookControlRequest,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	return runtime.controlNotebook(request, context, signal);
}

export function normalizeNotebookRequest(params: NotebookToolParameters, allowCheckpoint = false, allowSelectedData = false): NotebookControlRequest {
	params = {
		action: params.action,
		...(params.query == null ? {} : { query: params.query }),
		...(params.name == null ? {} : { name: params.name }),
		...(params.names == null ? {} : { names: params.names }),
		...(params.hook == null ? {} : { hook: params.hook }),
		...(params.event === undefined ? {} : { event: params.event }),
		...(params.checkpoint === undefined ? {} : { checkpoint: params.checkpoint }),
	};
	if (params.action === "hook") {
		if (!params.name || params.query !== undefined || params.names !== undefined || params.hook !== undefined || params.checkpoint !== undefined || params.event !== false && params.event !== "startup" && params.event !== "tool_result") throw new Error("notebook hook requires name and event: startup, tool_result, or false");
		return { action: "hook", name: params.name, event: params.event };
	}
	if (params.event !== undefined) throw new Error("event requires notebook hook");
	if (params.checkpoint !== undefined && (!allowCheckpoint || params.action !== "pin" || params.names?.length !== 1 || params.hook !== undefined || !params.checkpoint || typeof params.checkpoint.snapshot !== "string" || typeof params.checkpoint.restore !== "string")) throw new Error("TS checkpoint requires pin, one binding, named snapshot and restore helpers, and no hook");
	if (params.hook !== undefined && (params.action !== "pin" || params.hook !== false && params.hook !== "startup" && params.hook !== "tool_result")) {
		throw new Error("notebook hook requires pin and startup, tool_result, or false");
	}
	if (params.action === "status" || params.action === "list") {
		if (params.name !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts query only`);
		return { action: params.action, ...(params.query === undefined ? {} : { query: params.query }) };
	}
	if (params.action === "save" || params.action === "load") {
		if (allowSelectedData && params.action === "save" && params.names !== undefined) {
			if (!params.name || !params.names.length || params.query !== undefined) throw new Error("Selective JS save requires name and nonempty names");
			return { action: "save", name: params.name, names: [...new Set(params.names)] };
		}
		if (params.query !== undefined || params.names !== undefined) throw new Error(`notebook ${params.action} accepts name only`);
		if (!params.name) throw new Error(`notebook ${params.action} requires name`);
		return { action: params.action, name: params.name };
	}
	if (params.action === "release" || params.action === "pin" || params.action === "unpin") {
		if (params.query !== undefined || params.name !== undefined) throw new Error(`notebook ${params.action} accepts names only`);
		if (!params.names?.length) throw new Error(`notebook ${params.action} requires at least one name`);
		return { action: params.action, names: [...new Set(params.names)], ...(params.action === "pin" && params.hook !== undefined ? { hook: params.hook } : {}), ...(params.action === "pin" && params.checkpoint ? { checkpoint: params.checkpoint } : {}) };
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
