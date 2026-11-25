import { NOTEBOOK_HELP } from "./notebook-help.ts";
import type {
	ExtensionAPI,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "../string-enum.ts";
import {
	arr,
	compile,
	lit,
	obj,
	opt,
	str,
	union,
	type Static,
} from "@earendil-works/pi-schema";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import type { SharedCodeModeRuntime } from "../execution/runtime.ts";
import { notebookRenderers } from "./notebook-rendering.ts";
import type {
	NotebookControlRequest,
	ProgrammaticCodeModeToolDefinition,
} from "../code-mode/types.ts";

const PIN_FIELDS = {
	action: { ...lit("pin"), type: "string" },
	names: arr(str(), { minItems: 1 }),
	hook: opt(
		union(
			[
				StringEnum(["startup", "tool_result"]),
				{ ...lit(false), type: "boolean" },
			],
			{
				description:
					"Self-contained fn(event); tool_result gets {type,toolName,input,status,result?,error?}; hook tool calls do not retrigger; false removes hook",
			},
		),
	),
};
const NOTEBOOK_ACTION_PARAMETERS = union([
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
	obj({
		...PIN_FIELDS,
		checkpoint: opt(obj({ snapshot: str(), restore: str() })),
	}),
	obj({
		action: StringEnum(["unpin", "release"]),
		names: arr(str(), { minItems: 1 }),
	}),
	obj({
		action: { ...lit("prune"), type: "string" },
		query: str(),
	}),
]);
const notebookActions = compile(NOTEBOOK_ACTION_PARAMETERS);

export const NOTEBOOK_PARAMETERS = obj({
	input: opt(
		str({
			description:
				'help or JSON, e.g. {"action":"status"}; not a bare action name',
		}),
	),
});
const notebookArguments = compile(NOTEBOOK_PARAMETERS);

const NOTEBOOK_DISCOVERY_PARAMETERS = obj({
	action: opt({ ...lit("help"), type: "string" }),
});
const notebookDiscovery = compile(NOTEBOOK_DISCOVERY_PARAMETERS);

const NOTEBOOK_DESCRIPTION = "Manage persistent notebook state";

type NotebookToolParameters = {
	action: string;
	query?: string | undefined;
	name?: string | undefined;
	names?: string[] | undefined;
	hook?: string | false | undefined;
	checkpoint?: { snapshot: string; restore: string } | undefined;
};

export function registerNotebookTool(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
): void {
	const constrainedSampling = getExperimentalToolSampling("notebook");
	pi.registerTool({
		name: "notebook",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Notebook",
		description: NOTEBOOK_DESCRIPTION,
		parameters: NOTEBOOK_PARAMETERS,
		prepareArguments(args) {
			let prepared = args;
			if (typeof prepared === "string") prepared = { input: prepared };
			if (
				prepared &&
				typeof prepared === "object" &&
				!Array.isArray(prepared)
			) {
				if ("action" in prepared && !("input" in prepared))
					prepared = { input: JSON.stringify(prepared) };
				else if (
					"input" in prepared &&
					prepared.input !== null &&
					typeof prepared.input === "object"
				)
					prepared = { ...prepared, input: JSON.stringify(prepared.input) };
			}
			if (!notebookArguments.check(prepared))
				throw new Error("Invalid notebook arguments; call notebook({})");
			return prepared;
		},
		...notebookRenderers,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(
			_id,
			params: Static<typeof NOTEBOOK_PARAMETERS>,
			signal,
			_onUpdate,
			ctx,
		) {
			if (runtime.executionKind(ctx) !== "ts")
				throw new Error("Notebook controls require TS Notebook");
			if (params.input === undefined || params.input === "help")
				return {
					content: [{ type: "text", text: NOTEBOOK_HELP }],
					details: { action: "help" },
				};
			let action: unknown;
			try {
				action = JSON.parse(params.input);
			} catch (error) {
				throw new Error(
					"notebook input must be help or a JSON action object; call notebook({})",
					{ cause: error },
				);
			}
			if (notebookDiscovery.check(action))
				return {
					content: [{ type: "text", text: NOTEBOOK_HELP }],
					details: { action: "help" },
				};
			const result = await runtime.controlNotebook(
				parseNotebookRequest(action),
				{
					cwd: ctx.cwd,
					extensionContext: ctx,
				},
				signal,
			);
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
		usage: "tools.notebook()",
		discovery: "help",
		description: NOTEBOOK_DESCRIPTION,
		deferLoading: true,
		kind: "function",
		inputSchema: union([
			NOTEBOOK_DISCOVERY_PARAMETERS,
			NOTEBOOK_ACTION_PARAMETERS,
		]),
		async invoke(input, context, signal) {
			if (input === undefined || notebookDiscovery.check(input))
				return {
					message: NOTEBOOK_HELP,
					details: { action: "help" },
				};
			const request = parseNotebookRequest(input);
			if (!canExecuteNotebookControlInsideExec(request))
				return {
					message: `Notebook ${request.action} not run. After exec finishes, call notebook with ${JSON.stringify({ input: JSON.stringify(request) })}.`,
					details: { notRun: true, action: request.action, retry: request },
				};
			return runtime.controlNotebook(request, context, signal);
		},
	};
}

function parseNotebookRequest(input: unknown): NotebookControlRequest {
	if (!notebookActions.check(input))
		throw new Error(
			"Invalid notebook action; call notebook({}) for supported controls",
		);
	return normalizeNotebookRequest(input);
}

function canExecuteNotebookControlInsideExec(
	request: NotebookControlRequest,
): boolean {
	return (
		request.action === "list" ||
		request.action === "diagnostics" ||
		(request.action === "status" && request.query === undefined)
	);
}

function normalizeNotebookRequest(
	params: NotebookToolParameters,
): NotebookControlRequest {
	params = {
		action: params.action,
		...(params.query == null ? {} : { query: params.query }),
		...(params.name == null ? {} : { name: params.name }),
		...(params.names == null ? {} : { names: params.names }),
		...(params.hook == null ? {} : { hook: params.hook }),
		...(params.checkpoint === undefined
			? {}
			: { checkpoint: params.checkpoint }),
	};
	if (
		params.checkpoint !== undefined &&
		(params.action !== "pin" ||
			params.names?.length !== 1 ||
			params.hook !== undefined ||
			!params.checkpoint ||
			typeof params.checkpoint.snapshot !== "string" ||
			typeof params.checkpoint.restore !== "string")
	)
		throw new Error(
			"TS checkpoint requires pin, one binding, named snapshot and restore helpers, and no hook",
		);
	if (
		params.hook !== undefined &&
		(params.action !== "pin" ||
			(params.hook !== false &&
				params.hook !== "startup" &&
				params.hook !== "tool_result"))
	) {
		throw new Error(
			"notebook hook requires pin and startup, tool_result, or false",
		);
	}
	if (params.action === "status" || params.action === "list") {
		if (params.name !== undefined || params.names !== undefined)
			throw new Error(`notebook ${params.action} accepts query only`);
		return {
			action: params.action,
			...(params.query === undefined ? {} : { query: params.query }),
		};
	}
	if (params.action === "save" || params.action === "load") {
		if (params.query !== undefined || params.names !== undefined)
			throw new Error(`notebook ${params.action} accepts name only`);
		if (!params.name)
			throw new Error(`notebook ${params.action} requires name`);
		return { action: params.action, name: params.name };
	}
	if (
		params.action === "release" ||
		params.action === "pin" ||
		params.action === "unpin"
	) {
		if (params.query !== undefined || params.name !== undefined)
			throw new Error(`notebook ${params.action} accepts names only`);
		if (!params.names?.length)
			throw new Error(`notebook ${params.action} requires at least one name`);
		return {
			action: params.action,
			names: [...new Set(params.names)],
			...(params.action === "pin" && params.hook !== undefined
				? { hook: params.hook }
				: {}),
			...(params.action === "pin" && params.checkpoint
				? { checkpoint: params.checkpoint }
				: {}),
		};
	}
	if (params.action === "prune") {
		if (params.name !== undefined || params.names !== undefined)
			throw new Error("notebook prune accepts query only");
		if (!params.query) throw new Error("notebook prune requires query");
		return { action: "prune", query: params.query };
	}
	if (
		params.action !== "checkpoint" &&
		params.action !== "restart" &&
		params.action !== "diagnostics" &&
		params.action !== "reset"
	) {
		throw new Error(`Unsupported notebook action: ${params.action}`);
	}
	if (
		params.query !== undefined ||
		params.name !== undefined ||
		params.names !== undefined
	) {
		throw new Error(`notebook ${params.action} accepts only action`);
	}
	return { action: params.action };
}
