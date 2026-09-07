import { runCodeModeToolPreflight } from "./nested-tool-preflight.js";
import type { CodeModeToolCompletionCall } from "./preflight-protocol.js";
import type { RuntimeToolResult, ToolExecutionContext } from "./types.js";

// Completion is observational: neither snapshot nor subscriber failures may
// replace the tool's return value or original error.
export async function runCodeModeToolWithHooks(
	toolName: string,
	input: unknown,
	context: ToolExecutionContext,
	signal: AbortSignal,
	run: (context: ToolExecutionContext) => Promise<unknown>,
): Promise<unknown> {
	let call: CodeModeToolCompletionCall | undefined;
	if (context.completion) {
		try {
			if (!context.toolCallId || !context.extensionContext)
				throw new Error("Code Mode nested tool completion context is unavailable");
			call = {
				toolName,
				input: structuredClone(input),
				toolCallId: context.toolCallId,
				cwd: context.cwd,
				extensionContext: context.extensionContext,
				signal,
				status: "success",
				result: undefined,
			};
		} catch (error) {
			console.error("Code Mode completion snapshot failed", error);
		}
	}
	let phase: "preflight" | "execution" = "preflight";
	let captured = false;
	const invocationContext = call ? {
		...context,
		captureResult: (result: RuntimeToolResult) => {
			captured = true;
			if (call) call.result = result;
			context.captureResult?.(result);
		},
	} : context;
	try {
		await runCodeModeToolPreflight(toolName, input, invocationContext, signal);
		phase = "execution";
		const result = await run(invocationContext);
		if (call && !captured) call.result = result;
		return result;
	} catch (error) {
		if (call) call = {
			...call,
			status: "error",
			phase,
			error: error instanceof Error ? error.message : String(error),
		};
		throw error;
	} finally {
		if (call) {
			try {
				await context.completion?.(call);
			} catch (error) {
				console.error("Code Mode completion subscriber failed", error);
			}
		}
	}
}
