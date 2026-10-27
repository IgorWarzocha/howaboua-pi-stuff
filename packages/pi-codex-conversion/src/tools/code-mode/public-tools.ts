import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { getExperimentalToolSampling } from "../tool-sampling.ts";
import {
	DEFAULT_CODE_MODE_OUTPUT_TOKENS,
	MAX_CODE_MODE_OUTPUT_TOKENS,
} from "./host-protocol.js";
import {
	EXEC_DESCRIPTION,
	GPT_EXEC_DESCRIPTION,
	GPT_ISOLATED_EXEC_GUIDANCE,
	GPT_JS_EXEC_DESCRIPTION,
	ISOLATED_EXEC_GUIDANCE,
	JS_EXEC_DESCRIPTION,
	WAIT_DESCRIPTION,
} from "./custom-tool-prompt.js";
import { createCodeModeRenderTracker } from "./render-tracker.js";
import {
	renderExecCall,
	renderWaitCall,
} from "./call-rendering.js";
import { renderTrackedCodeModeResult } from "./result-rendering.js";
import type { SharedCodeModeRuntime } from "./shared-runtime.js";
import {
	formatRunningExecSessionGuidance,
	toCodeModeToolResult,
} from "./tool-result.js";
import type {
	CodeModeRenderContext,
	CodeModeRenderTheme,
	ToolExecutionContext,
} from "./types.js";
import { CODE_MODE_EXEC_CONSTRAINED_SAMPLING } from "./exec-contract.js";
import {
	registerCodeModePreflightBroker,
} from "./nested-tool-preflight.js";
import { runCodeModeToolWithHooks } from "./nested-tool-completion.js";
import { registerNotebookTool } from "./notebook-tool.ts";
import { PiToolCallScope } from "./pi-tool-call-scope.ts";
import { registerGptPromptMode } from "../../prompt-mode.ts";

const DEFAULT_WAIT_MS = 10_000;
const MIN_ADAPTIVE_WAIT_MS = 5_000;
const MAX_ADAPTIVE_WAIT_MS = 1_800_000;
type RenderTracker = ReturnType<typeof createCodeModeRenderTracker>;
const EXEC_PARAMETERS = Type.Object({
	code: Type.String(),
});
const WAIT_PARAMETERS = Type.Object({
	cell_id: Type.String(),
	yield_time_ms: Type.Optional(
		Type.Integer({
			minimum: 0,
			default: DEFAULT_WAIT_MS,
		}),
	),
	max_tokens: Type.Optional(
		Type.Integer({
			minimum: 1,
			maximum: MAX_CODE_MODE_OUTPUT_TOKENS,
			default: DEFAULT_CODE_MODE_OUTPUT_TOKENS,
		}),
	),
	terminate: Type.Optional(Type.Boolean()),
});

export function registerPublicCodeModeTools(
	pi: ExtensionAPI,
	runtime: SharedCodeModeRuntime,
): void {
	const tracker = createCodeModeRenderTracker();
	const waitAttempts = new Map<string, number>();
	const renderResult = createResultRenderer(runtime, tracker);
	const broker = registerCodeModePreflightBroker(pi);
	const hooks = { preflight: broker.run, completion: broker.complete };
	let gpt = false;
	const isGpt = () => gpt;
	const exec = createExecTool(runtime, tracker, renderResult, hooks, isGpt);
	const wait = createWaitTool(runtime, tracker, renderResult, waitAttempts, hooks, isGpt);
	pi.registerTool(exec);
	pi.registerTool(wait);
	let currentExec = exec;
	registerGptPromptMode(pi, (active, context) => {
		gpt = active;
		const js = context !== undefined && runtime.executionKind(context) === "js";
		const ts = context !== undefined && runtime.executionKind(context) === "ts";
		const deno = context !== undefined && runtime.executionKind(context) === "notebook";
		const description = js ? (active ? GPT_JS_EXEC_DESCRIPTION : JS_EXEC_DESCRIPTION)
			: (active ? GPT_EXEC_DESCRIPTION : EXEC_DESCRIPTION).replace("JavaScript", ts ? "TypeScript" : "JavaScript")
				+ (ts || deno ? `\n${active ? GPT_ISOLATED_EXEC_GUIDANCE : ISOLATED_EXEC_GUIDANCE}` : "");
		const executionMode = ts || js || deno ? "parallel" : "sequential";
		if (currentExec.description !== description || currentExec.executionMode !== executionMode) {
			if (currentExec.executionMode !== executionMode) pi.registerTool({ ...wait, executionMode });
			currentExec = { ...exec, description, executionMode, promptSnippet: `Compose tools with ${ts ? "TypeScript" : "JavaScript"}` };
			pi.registerTool(currentExec);
		}
		return [currentExec];
	});
	registerNotebookTool(pi, runtime);
}

function createExecTool(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
	renderResult: ReturnType<typeof createResultRenderer>,
	hooks: Pick<ToolExecutionContext, "preflight" | "completion">,
	isGpt: () => boolean,
): ToolDefinition<typeof EXEC_PARAMETERS> {
	return {
		name: "exec",
		defaultActive: false,
		exposure: "model-only",
		executionMode: "sequential",
		label: "Exec",
		description: EXEC_DESCRIPTION,
		promptSnippet: "Compose tools with JavaScript",
		parameters: EXEC_PARAMETERS,
		constrainedSampling: CODE_MODE_EXEC_CONSTRAINED_SAMPLING,
		prepareLoadout: (loadout) => runtime.prepareLoadout(loadout),
		reachesTools: ({ code }) => {
			// Pi waits for named MCP servers before this cell snapshots its tools.
			if (typeof code !== "string") return [];
			return /\bALL_TOOLS\b/.test(code) ? "all" : (code.match(/\w+/g) ?? []);
		},
		async execute(id, params, signal, onUpdate, ctx) {
			tracker.start(id);
			const piToolScope = new PiToolCallScope(ctx, signal);
			try {
				const tools = runtime.collectTools(ctx);
				const guard = tools.some(tool => "invoke" in tool && tool.opaqueResult)
					? await runtime.opaqueContextGuard(ctx) : undefined;
				const response = await (await runtime.getClient(ctx)).execute(
					params.code,
					{ cwd: ctx.cwd, toolCallId: id, originalExecCallId: id, extensionContext: ctx, piToolScope, ...hooks, onUpdate,
						opaqueScope: guard?.scope, opaqueContextGeneration: guard?.generation, opaqueContextValid: guard?.valid,
						resolveOpaqueScope: guard?.lazy ? guard.resolveScope : undefined },
					signal,
					tools,
				);
				if (guard?.lazy && response.opaqueOutputs?.length) await guard.resolveScope();
				if (guard && !await guard.valid())
					throw new Error("Remote context changed after execution; check completed results before retrying");
				const visible = runtime.deliverOpaqueResponse(response, id, guard);
				tracker.finish(
					id,
					visible.kind === "yielded" ? "yielded" : "done",
				);
				return toCodeModeToolResult(visible, undefined, isGpt());
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
				runtime.useRichRendering(),
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
	isGpt: () => boolean,
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
		async execute(id, params, signal, onUpdate, ctx) {
			tracker.start(id);
			const piToolScope = new PiToolCallScope(ctx, signal);
			try {
				signal?.throwIfAborted();
				const completed = await runtime.completedCell(params.cell_id, ctx);
				if (completed) {
					waitAttempts.delete(params.cell_id);
					tracker.finish(id, "done");
					return toCodeModeToolResult(completed, params.max_tokens, isGpt());
				}
				const client = await runtime.getClient(ctx);
				const guard = runtime.collectTools(ctx).some(tool => "invoke" in tool && tool.opaqueResult)
					? await runtime.opaqueContextGuard(ctx) : undefined;
				const context = { cwd: ctx.cwd, toolCallId: id, extensionContext: ctx, piToolScope, ...hooks, onUpdate,
					opaqueScope: guard?.scope, opaqueContextGeneration: guard?.generation, opaqueContextValid: guard?.valid,
					resolveOpaqueScope: guard?.lazy ? guard.resolveScope : undefined };
				const attempt = waitAttempts.get(params.cell_id) ?? 0;
				const resumed = params.terminate
					? await client.terminate(params.cell_id, context, signal)
					: await client.wait(
							params.cell_id,
							adaptiveWaitMs(params.yield_time_ms ?? DEFAULT_WAIT_MS, attempt),
							context,
							signal,
						);
				if (guard?.lazy && resumed.opaqueOutputs?.length) await guard.resolveScope();
				if (guard && !await guard.valid())
					throw new Error("Remote context changed after execution; check completed results before retrying");
				if (resumed.missingCell && guard)
					throw new Error("Remote cell unavailable; operations may already have executed, so check completed results before retrying");
				const response = runtime.deliverOpaqueResponse(resumed, id, guard);
				const recovered =
					!params.terminate &&
					response.missingCell === true
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
				tracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toCodeModeToolResult(response, params.max_tokens, isGpt());
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
				runtime.useRichRendering(),
			)) as any,
		renderResult: renderResult as any,
	};
}

async function continueExecSessionFromMistakenWait(
	cellId: string,
	yieldTimeMs: number,
	maxOutputTokens: number | undefined,
	runtime: SharedCodeModeRuntime,
	context: ToolExecutionContext,
	signal?: AbortSignal,
): Promise<
	| {
			running: boolean;
			result: {
				content: Array<{ type: "text"; text: string }>;
				details: unknown;
			};
	  }
	| undefined
> {
	if (!/^\d+$/.test(cellId)) return undefined;
	const sessionId = Number(cellId);
	if (!Number.isSafeInteger(sessionId) || String(sessionId) !== cellId)
		return undefined;
	const writeStdin = runtime
		.collectTools(context.extensionContext)
		.find((tool) => tool.name === "write_stdin" && "invoke" in tool);
	if (!writeStdin || !("invoke" in writeStdin)) return undefined;
	const input = {
		session_id: sessionId,
		yield_time_ms: yieldTimeMs,
		...(maxOutputTokens === undefined
			? {}
			: { max_output_tokens: maxOutputTokens }),
	};
	const nestedSignal = signal ?? new AbortController().signal;
	let value: unknown;
	let invoked = false;
	try {
		const invoke = (hookContext: ToolExecutionContext) => {
			invoked = true;
			return writeStdin.invoke(input, hookContext, nestedSignal);
		};
		value = writeStdin.executionPipeline === "adapter"
			? await invoke(context)
			: await runCodeModeToolWithHooks(writeStdin.name, input, context, nestedSignal, invoke);
	} catch (fallbackError) {
		const fallbackMessage =
			fallbackError instanceof Error
				? fallbackError.message
				: String(fallbackError);
		if (invoked && /unknown process id/i.test(fallbackMessage)) return undefined;
		throw fallbackError;
	}
	if (!value || typeof value !== "object" || !("output" in value))
		return undefined;
	const output = typeof value.output === "string" ? value.output : "";
	const exitCode =
		"exit_code" in value && typeof value.exit_code === "number"
			? value.exit_code
			: undefined;
	const running =
		"session_id" in value && typeof value.session_id === "number";
	return {
		running,
		result: {
			content: [
				{
					type: "text",
					text: `Recovered wait cell_id ${cellId} as exec_command session_id ${sessionId} and continued it with write_stdin`,
				},
				...(output ? [{ type: "text" as const, text: output }] : []),
				...(exitCode === undefined
					? []
					: [
							{
								type: "text" as const,
								text: `Process exited with code ${exitCode}`,
							},
						]),
				...(running
					? [
							{
								type: "text" as const,
								text: formatRunningExecSessionGuidance(sessionId),
							},
						]
					: []),
			],
			details: value,
		},
	};
}

function adaptiveWaitMs(requestedMs: number, previousIncompleteWaits: number): number {
	const multiplier = 2 ** previousIncompleteWaits;
	const grown = requestedMs * multiplier * 2;
	const adaptive = Math.min(MAX_ADAPTIVE_WAIT_MS, Math.max(MIN_ADAPTIVE_WAIT_MS * multiplier, grown));
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
			runtime.useRichRendering(),
			runtime.useMinimalOutput(),
		);
}
