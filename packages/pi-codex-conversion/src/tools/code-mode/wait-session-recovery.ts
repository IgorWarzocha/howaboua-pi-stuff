import type { SharedCodeModeRuntime } from "./shared-runtime.js";
import type { ToolExecutionContext } from "./types.js";
import { runCodeModeToolWithHooks } from "./nested-tool-completion.js";
import { formatRunningExecSessionGuidance } from "./tool-result.js";

export async function continueExecSessionFromMistakenWait(
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
