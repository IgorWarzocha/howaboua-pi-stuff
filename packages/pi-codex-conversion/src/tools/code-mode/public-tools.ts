import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	DEFAULT_CODE_MODE_OUTPUT_TOKENS,
	MAX_CODE_MODE_OUTPUT_TOKENS,
} from "./host-protocol.js";
import {
	EXEC_DESCRIPTION,
	WAIT_DESCRIPTION,
} from "./custom-tool-prompt.js";
import { createCodeModeRenderTracker } from "./render-tracker.js";
import {
	type RenderContext,
	type RenderTheme,
	renderExecCall,
	renderTrackedCodeModeResult,
	renderWaitCall,
} from "./rendering.js";
import type { SharedCodeModeRuntime } from "./shared-runtime.js";
import { toCodeModeToolResult } from "./tool-result.js";

const DEFAULT_WAIT_MS = 10_000;
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
	const renderResult = createResultRenderer(runtime, tracker);
	pi.registerTool(createExecTool(runtime, tracker, renderResult));
	pi.registerTool(createWaitTool(runtime, tracker, renderResult));
}

function createExecTool(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
	renderResult: ReturnType<typeof createResultRenderer>,
): ToolDefinition<typeof EXEC_PARAMETERS> {
	return {
		name: "exec",
		label: "Exec",
		description: EXEC_DESCRIPTION,
		promptSnippet: "Compose tools with JavaScript.",
		parameters: EXEC_PARAMETERS,
		async execute(id, params, signal, onUpdate, ctx) {
			tracker.start(id);
			try {
				const response = await (await runtime.getClient()).execute(
					params.code,
					{ cwd: ctx.cwd, extensionContext: ctx, onUpdate },
					signal,
					runtime.collectTools(ctx),
				);
				tracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toCodeModeToolResult(response);
			} catch (error) {
				tracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { code?: unknown },
			theme: RenderTheme,
			context: RenderContext,
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
): ToolDefinition<typeof WAIT_PARAMETERS> {
	return {
		name: "wait",
		label: "Wait",
		description: WAIT_DESCRIPTION,
		promptSnippet: "Resume or terminate an exec cell.",
		parameters: WAIT_PARAMETERS,
		async execute(id, params, signal, onUpdate, ctx) {
			tracker.start(id);
			try {
				const client = await runtime.getClient();
				const context = { cwd: ctx.cwd, extensionContext: ctx, onUpdate };
				const response = params.terminate
					? await client.terminate(params.cell_id, context, signal)
					: await client.wait(
							params.cell_id,
							params.yield_time_ms ?? DEFAULT_WAIT_MS,
							context,
							signal,
						);
				tracker.finish(
					id,
					response.kind === "yielded" ? "yielded" : "done",
				);
				return toCodeModeToolResult(response, params.max_tokens);
			} catch (error) {
				tracker.finish(id);
				throw error;
			}
		},
		renderCall: ((
			args: { cell_id?: unknown; terminate?: unknown },
			theme: RenderTheme,
			context: RenderContext,
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

function createResultRenderer(
	runtime: SharedCodeModeRuntime,
	tracker: RenderTracker,
) {
	return (
		result: Parameters<typeof renderTrackedCodeModeResult>[0],
		options: Parameters<typeof renderTrackedCodeModeResult>[1],
		theme: RenderTheme,
		context: RenderContext,
	) =>
		renderTrackedCodeModeResult(
			result,
			options,
			theme,
			context,
			tracker,
			runtime.collectRenderTools(),
			runtime.useRichRendering(),
		);
}
