import { notebookHelpForMode } from "./notebook-help.ts";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "../string-enum.ts";
import { arr, compile, lit, obj, opt, str, union, type Static } from "@earendil-works/pi-schema";
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

const PIN_FIELDS = {
	action: { ...lit("pin"), type: "string" },
	names: arr(str(), { minItems: 1 }),
	hook: opt(union([StringEnum(["startup", "tool_result"]), { ...lit(false), type: "boolean" }], {
		description: "Await self-contained fn(event); tool_result gets {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger; false removes hook",
	})),
};
const PIN_PARAMETERS = obj(PIN_FIELDS);

function notebookActionParameters(allowCheckpoint = false) {
	return union([
		obj({
			action: StringEnum(["status", "list"]),
			query: opt(str()),
		}),
		obj({
			action: StringEnum(["checkpoint", "restart", "diagnostics", "reset"]),
		}),
		obj({
			action: StringEnum(["save", "load"]),
			name: str(),
		}),
		allowCheckpoint ? obj({ ...PIN_FIELDS, checkpoint: opt(obj({ snapshot: str(), restore: str() })) }) : PIN_PARAMETERS,
		obj({
			action: StringEnum(["unpin", "release"]),
			names: arr(str(), { minItems: 1 }),
		}),
		obj({
			action: { ...lit("prune"), type: "string" },
			query: str(),
		}),
	]);
}

function actionParameters(kind: string) {
	return kind === "ts" ? TS_ACTION_PARAMETERS : NOTEBOOK_ACTION_PARAMETERS;
}

const NOTEBOOK_ACTION_PARAMETERS = notebookActionParameters();
const TS_ACTION_PARAMETERS = notebookActionParameters(true);
const notebookActions = compile(NOTEBOOK_ACTION_PARAMETERS);
const tsActions = compile(TS_ACTION_PARAMETERS);

function actionValidator(kind: string) {
	return kind === "ts" ? tsActions : notebookActions;
}

export const NOTEBOOK_PARAMETERS = obj({
	input: opt(str({ description: 'help or JSON, e.g. {"action":"status"}; not a bare action name' })),
});
const notebookArguments = compile(NOTEBOOK_PARAMETERS);

const NOTEBOOK_DISCOVERY_PARAMETERS = obj({
	action: opt({ ...lit("help"), type: "string" }),
});
const notebookDiscovery = compile(NOTEBOOK_DISCOVERY_PARAMETERS);

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
			if (!notebookArguments.check(prepared)) throw new Error('Invalid notebook arguments; call notebook({})');
			return prepared;
		},
		...notebookRenderers,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(_id, params: Static<typeof NOTEBOOK_PARAMETERS>, signal, _onUpdate, ctx) {
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
			if (notebookDiscovery.check(action)) return {
				content: [{ type: "text", text: notebookHelp(runtime, ctx) }],
				details: { action: "help" },
			};
			if (!actionValidator(runtime.executionKind(ctx)).check(action)) {
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
	kind: "notebook" | "ts" = "notebook",
): ProgrammaticCodeModeToolDefinition {
	return {
		name: "notebook",
		usage: "await tools.notebook()",
		discovery: "help",
		description: NOTEBOOK_DESCRIPTION,
		deferLoading: true,
		kind: "function",
		inputSchema: union([NOTEBOOK_DISCOVERY_PARAMETERS, actionParameters(kind)]),
		invoke: (input, context, signal) => {
			if (input === undefined || notebookDiscovery.check(input))
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
	return executeNormalizedNotebookControl(runtime, normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts"), context, signal);
}

export async function executeNotebookExecControl(
	runtime: SharedCodeModeRuntime,
	params: NotebookToolParameters,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	validateModeRequest(runtime, params, context);
	const request = normalizeNotebookRequest(params, runtime.executionKind(context.extensionContext) === "ts");
	if (!canExecuteNotebookControlInsideExec(request))
		return {
			message: `Notebook ${request.action} was not run because it needs the active exec cell to finish. After exec returns, call notebook with ${JSON.stringify({ input: JSON.stringify(request) })}.`,
			details: { notRun: true, action: request.action, retry: request },
		};
	return executeNormalizedNotebookControl(runtime, request, context, signal);
}

function validateModeRequest(runtime: SharedCodeModeRuntime, params: NotebookToolParameters, context: ToolExecutionContext): void {
	const kind = runtime.executionKind(context.extensionContext);
	if (kind !== "notebook" && kind !== "ts") throw new Error("Notebook controls require Notebook or TS mode.");
	if (!actionValidator(kind).check(params)) throw new Error("Invalid notebook action; call notebook({}) for supported controls");
}

function executeNormalizedNotebookControl(
	runtime: SharedCodeModeRuntime,
	request: NotebookControlRequest,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<NotebookControlResult> {
	return runtime.controlNotebook(request, context, signal);
}

export function normalizeNotebookRequest(params: NotebookToolParameters, allowCheckpoint = false): NotebookControlRequest {
	params = {
		action: params.action,
		...(params.query == null ? {} : { query: params.query }),
		...(params.name == null ? {} : { name: params.name }),
		...(params.names == null ? {} : { names: params.names }),
		...(params.hook == null ? {} : { hook: params.hook }),
		...(params.checkpoint === undefined ? {} : { checkpoint: params.checkpoint }),
	};
	if (params.checkpoint !== undefined && (!allowCheckpoint || params.action !== "pin" || params.names?.length !== 1 || params.hook !== undefined || !params.checkpoint || typeof params.checkpoint.snapshot !== "string" || typeof params.checkpoint.restore !== "string")) throw new Error("TS checkpoint requires pin, one binding, named snapshot and restore helpers, and no hook");
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
