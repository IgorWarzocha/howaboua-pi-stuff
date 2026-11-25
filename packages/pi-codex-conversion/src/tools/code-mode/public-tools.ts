import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
	bool,
	int,
	obj,
	opt,
	str,
	type Static,
} from "@earendil-works/pi-schema";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import {
	DEFAULT_EXEC_OUTPUT_TOKENS,
	MAX_EXEC_OUTPUT_TOKENS,
} from "./exec-contract.ts";
import {
	EXEC_DESCRIPTION,
	ISOLATED_EXEC_GUIDANCE,
	VM_EXEC_DESCRIPTION,
	WAIT_DESCRIPTION,
} from "./exec-descriptions.js";
import { createCodeModeRenderTracker } from "./render-tracker.js";
import { renderExecCall, renderWaitCall } from "./call-rendering.js";
import { renderTrackedCodeModeResult } from "./result-rendering.js";
import type { SharedCodeModeRuntime } from "../execution/runtime.js";
import { toCodeModeToolResult } from "./tool-result.js";
import type {
	CodeModeRenderContext,
	CodeModeRenderTheme,
	ToolExecutionContext,
} from "./types.js";
import { CODE_MODE_EXEC_CONSTRAINED_SAMPLING } from "./exec-contract.js";
import { registerCodeModePreflightBroker } from "./nested-tool-preflight.js";
import { continueExecSessionFromMistakenWait } from "./wait-session-recovery.js";
import { registerNotebookTool } from "../ts-mode/notebook-tool.ts";
import { PiToolCallScope } from "./pi-tool-call-scope.ts";

const DEFAULT_WAIT_MS = 10_000;
const MIN_ADAPTIVE_WAIT_MS = 5_000;
const MAX_ADAPTIVE_WAIT_MS = 1_800_000;
type RenderTracker = ReturnType<typeof createCodeModeRenderTracker>;
const EXEC_PARAMETERS = obj(
	{
		code: str(),
	},
	{ open: true },
);
const WAIT_PARAMETERS = obj(
	{
		cell_id: str(),
		yield_time_ms: opt(
			int({
				minimum: 0,
				default: DEFAULT_WAIT_MS,
			}),
		),
		max_tokens: opt(
			int({
				minimum: 1,
				maximum: MAX_EXEC_OUTPUT_TOKENS,
				default: DEFAULT_EXEC_OUTPUT_TOKENS,
			}),
		),
		terminate: opt(bool()),
	},
	{ open: true },
);

export function registerPublicCodeModeTools(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
) {
	const tracker = createCodeModeRenderTracker();
	const waitAttempts = new Map<string, number>();
	const renderResult = createResultRenderer(runtime, tracker);
	const broker = registerCodeModePreflightBroker(pi);
	const hooks = { preflight: broker.run, completion: broker.complete };
	const exec = createExecTool(runtime, tracker, renderResult, hooks);
	const wait = createWaitTool(
		runtime,
		tracker,
		renderResult,
		waitAttempts,
		hooks,
	);
	pi.registerTool(exec);
	pi.registerTool(wait);
	registerNotebookTool(pi, runtime);
	let currentExec = exec;
	return (context: ExtensionContext, toolSnippets: Record<string, string>) => {
		const kind = runtime.executionKind(context);
		const vm = kind === "vm";
		const notebook = kind === "ts";
		const language = notebook ? "TypeScript" : "JavaScript";
		const description = vm
			? VM_EXEC_DESCRIPTION
			: EXEC_DESCRIPTION.replace("JavaScript", language) +
				(notebook ? `\n${ISOLATED_EXEC_GUIDANCE}` : "");
		const executionMode = notebook ? "parallel" : "sequential";
		const promptSnippet = `Run ${language} cells`;
		if (
			currentExec.description !== description ||
			currentExec.executionMode !== executionMode
		) {
			if (currentExec.executionMode !== executionMode)
				pi.registerTool({ ...wait, executionMode });
			currentExec = {
				...exec,
				description,
				executionMode,
				promptSnippet,
			};
			pi.registerTool(currentExec);
		}
		// Pi has already cloned prompt options for this kickoff.
		toolSnippets["exec"] = promptSnippet;
	};
}

function createExecTool(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
	renderResult: ReturnType<typeof createResultRenderer>,
	hooks: Pick<ToolExecutionContext, "preflight" | "completion">,
): ToolDefinition<typeof EXEC_PARAMETERS> {
	return {
		name: "exec",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Exec",
		description: EXEC_DESCRIPTION,
		promptSnippet: "Run JavaScript cells",
		parameters: EXEC_PARAMETERS,
		constrainedSampling: CODE_MODE_EXEC_CONSTRAINED_SAMPLING,
		prepareLoadout: (loadout) => runtime.prepareLoadout(loadout),
		reachesTools: ({ code }) => {
			// Pi waits for named MCP servers before this cell snapshots its tools.
			if (typeof code !== "string") return [];
			return /\bALL_TOOLS\b/.test(code) ? "all" : (code.match(/\w+/g) ?? []);
		},
		async execute(
			id,
			params: Static<typeof EXEC_PARAMETERS>,
			signal,
			onUpdate,
			ctx,
		) {
			tracker.start(id);
			const piToolScope = new PiToolCallScope(ctx, signal);
			try {
				const tools = runtime.collectTools(ctx);
				const guard = tools.some(
					(tool) => "invoke" in tool && tool.opaqueResult,
				)
					? await runtime.opaqueContextGuard(ctx)
					: undefined;
				const response = await (
					await runtime.getClient(ctx)
				).execute(
					params.code,
					{
						cwd: ctx.cwd,
						toolCallId: id,
						originalExecCallId: id,
						extensionContext: ctx,
						piToolScope,
						...hooks,
						onUpdate,
						opaqueScope: guard?.scope,
						opaqueContextGeneration: guard?.generation,
						opaqueContextValid: guard?.valid,
						resolveOpaqueScope: guard?.lazy ? guard.resolveScope : undefined,
					},
					signal,
					tools,
				);
				if (guard?.lazy && response.opaqueOutputs?.length)
					await guard.resolveScope();
				if (guard && !(await guard.valid()))
					throw new Error(
						"Remote context changed after execution; check completed results before retrying",
					);
				const visible = runtime.deliverOpaqueResponse(response, id, guard);
				tracker.finish(id, visible.kind === "yielded" ? "yielded" : "done");
				return toCodeModeToolResult(visible);
			} catch (error) {
				tracker.finish(id);
				throw error;
			} finally {
				await piToolScope.close();
			}
		},
		renderCall: ((
			args: { code?: unknown },
			theme: CodeModeRenderTheme,
			context: CodeModeRenderContext,
		) =>
			renderExecCall(
				args,
				theme,
				context,
				tracker,
				runtime.toolDetails(),
			)) as any,
		renderResult: renderResult as any,
	};
}

function createWaitTool(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
	renderResult: ReturnType<typeof createResultRenderer>,
	waitAttempts: Map<string, number>,
	hooks: Pick<ToolExecutionContext, "preflight" | "completion">,
): ToolDefinition<typeof WAIT_PARAMETERS> {
	const constrainedSampling = getExperimentalToolSampling("wait");
	return {
		name: "wait",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Wait",
		description: WAIT_DESCRIPTION,
		promptSnippet: "Resume or terminate an exec cell",
		parameters: WAIT_PARAMETERS,
		...(constrainedSampling ? { constrainedSampling } : {}),
		async execute(
			id,
			params: Static<typeof WAIT_PARAMETERS>,
			signal,
			onUpdate,
			ctx,
		) {
			tracker.start(id);
			const piToolScope = new PiToolCallScope(ctx, signal);
			try {
				signal?.throwIfAborted();
				const completed = await runtime.completedCell(params.cell_id, ctx);
				if (completed) {
					waitAttempts.delete(params.cell_id);
					tracker.finish(id, "done");
					return toCodeModeToolResult(completed, params.max_tokens);
				}
				const client = await runtime.getClient(ctx);
				const guard = runtime
					.collectTools(ctx)
					.some((tool) => "invoke" in tool && tool.opaqueResult)
					? await runtime.opaqueContextGuard(ctx)
					: undefined;
				const context = {
					cwd: ctx.cwd,
					toolCallId: id,
					extensionContext: ctx,
					piToolScope,
					...hooks,
					onUpdate,
					opaqueScope: guard?.scope,
					opaqueContextGeneration: guard?.generation,
					opaqueContextValid: guard?.valid,
					resolveOpaqueScope: guard?.lazy ? guard.resolveScope : undefined,
				};
				const attempt = waitAttempts.get(params.cell_id) ?? 0;
				const resumed = params.terminate
					? await client.terminate(params.cell_id, context, signal)
					: await client.wait(
							params.cell_id,
							adaptiveWaitMs(params.yield_time_ms ?? DEFAULT_WAIT_MS, attempt),
							context,
							signal,
						);
				if (guard?.lazy && resumed.opaqueOutputs?.length)
					await guard.resolveScope();
				if (guard && !(await guard.valid()))
					throw new Error(
						"Remote context changed after execution; check completed results before retrying",
					);
				if (resumed.missingCell && guard)
					throw new Error(
						"Remote cell unavailable. Operations may have executed. Check completed results before retrying.",
					);
				const response = runtime.deliverOpaqueResponse(resumed, id, guard);
				const recovered =
					!params.terminate && response.missingCell === true
						? await continueExecSessionFromMistakenWait(
								params.cell_id,
								params.yield_time_ms ?? DEFAULT_WAIT_MS,
								params.max_tokens,
								runtime,
								context,
								signal,
							)
						: undefined;
				if (recovered) {
					waitAttempts.delete(params.cell_id);
					tracker.finish(id, recovered.running ? "yielded" : "done");
					return recovered.result;
				}
				if (response.kind === "yielded")
					waitAttempts.set(params.cell_id, attempt + 1);
				else waitAttempts.delete(params.cell_id);
				tracker.finish(id, response.kind === "yielded" ? "yielded" : "done");
				return toCodeModeToolResult(response, params.max_tokens);
			} catch (error) {
				waitAttempts.delete(params.cell_id);
				tracker.finish(id);
				throw error;
			} finally {
				await piToolScope.close();
			}
		},
		renderCall: ((
			args: { cell_id?: unknown; terminate?: unknown },
			theme: CodeModeRenderTheme,
			context: CodeModeRenderContext,
		) =>
			renderWaitCall(
				args,
				theme,
				context,
				tracker,
				runtime.toolDetails(),
			)) as any,
		renderResult: renderResult as any,
	};
}

function adaptiveWaitMs(
	requestedMs: number,
	previousIncompleteWaits: number,
): number {
	const multiplier = 2 ** previousIncompleteWaits;
	const grown = requestedMs * multiplier * 2;
	const adaptive = Math.min(
		MAX_ADAPTIVE_WAIT_MS,
		Math.max(MIN_ADAPTIVE_WAIT_MS * multiplier, grown),
	);
	return Math.max(requestedMs, adaptive);
}

function createResultRenderer(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
) {
	return (
		result: Parameters<typeof renderTrackedCodeModeResult>[0],
		options: Parameters<typeof renderTrackedCodeModeResult>[1],
		theme: CodeModeRenderTheme,
		context: CodeModeRenderContext,
	) =>
		renderTrackedCodeModeResult(
			result,
			options,
			theme,
			context,
			tracker,
			runtime.renderStore,
			runtime.collectRenderTools(),
			runtime.toolDetails(),
		);
}
