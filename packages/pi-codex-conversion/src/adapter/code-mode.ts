import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexExtensionRuntime } from "../extension/runtime.ts";
import {
	registerCodeModeTools,
	registerDynamicTools,
} from "../tools/code-mode/tools.ts";
import type {
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "../tools/code-mode/types.ts";
import { createExecCommandTool } from "../tools/exec/command-tool.ts";
import { createWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { shouldUseGpt56CodeMode } from "./activation/activation.ts";

export const CODE_MODE_TOOL_NAMES = ["exec", "wait"] as const;

export async function registerCodexCodeMode(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
): Promise<{ shutdown(): Promise<void> }> {
	const isActive = (ctx: unknown) =>
		shouldUseGpt56CodeMode(ctx as ExtensionContext, runtime.state.config);
	const dynamicRuntime = await registerDynamicTools(pi, undefined, {
		isActive,
	});
	const programmaticRuntime = await registerCodeModeTools(pi, {
		getTools: () => createNestedTools(runtime),
		isActive,
		providesRenderers: true,
		richRendering: () => runtime.state.config.ui.codeModeDetails,
	});
	return {
		async shutdown() {
			await programmaticRuntime.shutdown();
			await dynamicRuntime.shutdown();
		},
	};
}

function createNestedTools(
	runtime: CodexExtensionRuntime,
): ProgrammaticCodeModeToolDefinition[] {
	const options = {
		describeImagesForTextModels: runtime.state.config.tools.viewImageFallback,
		promptSnippet: false,
		customRendering: runtime.state.config.ui.toolRenaming,
		showOutputWhenCollapsed: true,
		compactTools: runtime.state.config.ui.compactTools,
	};
	return [
		toNestedTool(
			createExecCommandTool(runtime.tracker, runtime.sessions, options),
			"await tools.exec_command({ cmd: string, workdir?: string, shell?: string, tty?: boolean, yield_time_ms?: number, max_output_tokens?: number, login?: boolean })",
			{
				start(id, input) {
					const cmd =
						input &&
						typeof input === "object" &&
						"cmd" in input &&
						typeof input.cmd === "string"
							? input.cmd
							: "";
					if (cmd) runtime.tracker.recordStart(id, cmd);
				},
				end: (id) => runtime.tracker.recordEnd(id),
			},
		),
		toNestedTool(
			createWriteStdinTool(runtime.sessions, options),
			"await tools.write_stdin({ session_id: number, chars?: string, yield_time_ms?: number, max_output_tokens?: number })",
		),
	];
}

function toNestedTool(
	tool: Parameters<ExtensionAPI["registerTool"]>[0],
	usage: string,
	lifecycle: {
		start?(id: string, input: unknown): void;
		end?(id: string): void;
	} = {},
): ProgrammaticCodeModeToolDefinition {
	return {
		name: tool.name,
		usage,
		description: tool.description,
		deferLoading: false,
		kind: "function",
		inputSchema: tool.parameters,
		...(tool.renderCall
			? {
					renderCall: (input, theme, context) =>
						tool.renderCall!(input as never, theme as never, context as never),
				}
			: {}),
		...(tool.renderResult
			? {
					renderResult: (result, options, theme, context) =>
						tool.renderResult!(
							result as never,
							options,
							theme as never,
							context as never,
						),
				}
			: {}),
		async invoke(input, context, signal) {
			if (signal.aborted) throw new Error(`${tool.name} aborted`);
			const extensionContext = requireExtensionContext(context);
			const prepared = tool.prepareArguments
				? tool.prepareArguments(input)
				: input;
			if (signal.aborted) throw new Error(`${tool.name} aborted`);
			const toolCallId = context.toolCallId ?? `code-mode-${tool.name}`;
			lifecycle.start?.(toolCallId, prepared);
			context.refreshTrace?.();
			try {
				const result = await tool.execute(
					toolCallId,
					prepared,
					signal,
					(update) => forwardUpdate(update, context),
					extensionContext,
				);
				context.captureResult?.(result);
				return compactNestedResult(result);
			} finally {
				lifecycle.end?.(toolCallId);
			}
		},
	};
}

function requireExtensionContext(
	context: ToolExecutionContext,
): ExtensionContext {
	if (!context.extensionContext)
		throw new Error("Code-mode Pi context is unavailable");
	return context.extensionContext;
}

function forwardUpdate(
	update: AgentToolResult<unknown>,
	context: ToolExecutionContext,
): void {
	const content = update.content
		.filter((item) => item.type === "text" || item.type === "image")
		.map((item) => ({ ...item }));
	context.onUpdate?.({ content, details: update.details });
}

function compactNestedResult(result: AgentToolResult<unknown>): unknown {
	const images = result.content.filter((item) => item.type === "image");
	if (images.length > 0)
		return { content: result.content, details: result.details };
	if (
		result.details &&
		typeof result.details === "object" &&
		"output" in result.details
	)
		return result.details;
	const text = result.content
		.filter(
			(item): item is { type: "text"; text: string } => item.type === "text",
		)
		.map((item) => item.text)
		.join("\n");
	return text || "(no output)";
}
