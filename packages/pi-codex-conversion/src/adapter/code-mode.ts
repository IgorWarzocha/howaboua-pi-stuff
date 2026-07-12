import { randomUUID } from "node:crypto";
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
		customRendering: false,
		showOutputWhenCollapsed: false,
		compactTools: true,
	};
	return [
		toNestedTool(
			createExecCommandTool(runtime.tracker, runtime.sessions, options),
			"await tools.exec_command({ cmd: string, workdir?: string, shell?: string, tty?: boolean, yield_time_ms?: number, max_output_tokens?: number, login?: boolean })",
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
): ProgrammaticCodeModeToolDefinition {
	return {
		name: tool.name,
		usage,
		description: tool.description,
		deferLoading: false,
		kind: "function",
		inputSchema: tool.parameters,
		async invoke(input, context, signal) {
			if (signal.aborted) throw new Error(`${tool.name} aborted`);
			const extensionContext = requireExtensionContext(context);
			const prepared = tool.prepareArguments
				? tool.prepareArguments(input)
				: input;
			if (signal.aborted) throw new Error(`${tool.name} aborted`);
			const result = await tool.execute(
				`code-mode-${randomUUID()}`,
				prepared,
				signal,
				(update) => forwardUpdate(update, context),
				extensionContext,
			);
			return compactNestedResult(result);
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
		.filter(
			(item): item is { type: "text"; text: string } => item.type === "text",
		)
		.map((item) => ({ type: "text" as const, text: item.text }));
	if (content.length > 0)
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
