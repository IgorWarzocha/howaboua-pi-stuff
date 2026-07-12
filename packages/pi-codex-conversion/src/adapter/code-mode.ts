import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type { CodexExtensionRuntime } from "../extension/runtime.ts";
import {
	registerCodeModeTools,
	registerDynamicTools,
} from "../tools/code-mode/tools.ts";
import type {
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "../tools/code-mode/types.ts";
import { createApplyPatchTool } from "../tools/apply-patch/tool.ts";
import { createExecCommandTool } from "../tools/exec/command-tool.ts";
import { createWriteStdinTool } from "../tools/exec/write-stdin-tool.ts";
import { createImageGenerationTool, supportsNativeImageGeneration } from "../tools/imagegen/tool.ts";
import { createViewImageTool, supportsViewImageInputs } from "../tools/view-image/tool.ts";
import { createWebSearchTool } from "../tools/web-run/tool.ts";
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
		getTools: (ctx) => createNestedTools(runtime, ctx as ExtensionContext | undefined),
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
	ctx?: ExtensionContext,
): ProgrammaticCodeModeToolDefinition[] {
	const options = {
		describeImagesForTextModels: runtime.state.config.tools.viewImageFallback,
		promptSnippet: false,
		customRendering: runtime.state.config.ui.toolRenaming,
		showOutputWhenCollapsed: true,
		compactTools: runtime.state.config.ui.compactTools,
	};
	const tools: ProgrammaticCodeModeToolDefinition[] = [
		toNestedTool(
			createApplyPatchTool({
				promptSnippet: false,
				showDiffWhenCollapsed: !runtime.state.config.ui.compactTools,
			}),
			"await tools.apply_patch(patch)",
			{},
			{
				kind: "freeform",
				prepareInput(input) {
					if (typeof input !== "string")
						throw new Error("apply_patch expects a patch string");
					return { input };
				},
				resultError(result) {
					if (
						result.details &&
						typeof result.details === "object" &&
						"status" in result.details &&
						result.details.status === "partial_failure"
					)
						return result.content
							.filter((item) => item.type === "text")
							.map((item) => item.text)
							.join("\n") || "apply_patch partially failed";
					return undefined;
				},
			},
		),
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
	if (!ctx || supportsViewImageInputs(ctx.model) || runtime.state.config.tools.viewImageFallback) {
		const imageCapable = !ctx || supportsViewImageInputs(ctx.model);
		tools.push(toNestedTool(
			createViewImageTool({
				describeForTextModels: runtime.state.config.tools.viewImageFallback,
				promptSnippet: false,
				customRendering: runtime.state.config.ui.toolRenaming,
			}),
			imageCapable
				? "const result = await tools.view_image({ path: string, detail?: \"original\" }); image(result)"
				: "const description = await tools.view_image({ path: string }); text(description)",
			{},
			{ ...(imageCapable ? { resultValue: codeModeImageResult } : {}) },
		));
	}
	if (runtime.state.config.tools.webRun) {
		tools.push(toNestedTool(
			createWebSearchTool("web__run", {
				getRecentInput: () => runtime.latestRecentWebSearchInput,
				model: () => runtime.state.config.openai.webSearchModel,
				promptSnippet: false,
				customRendering: runtime.state.config.ui.toolRenaming,
			}),
			"await tools.web__run({ search_query?: [{ q: string, recency?: number, domains?: string[] }], image_query?: [{ q: string }], open?: [{ ref_id: string, lineno?: number }], click?: [{ ref_id: string, id: number }], find?: [{ ref_id: string, pattern: string }], response_length?: \"short\" | \"medium\" | \"long\" })",
		));
	}
	if (runtime.state.config.tools.imageGeneration && (!ctx || supportsNativeImageGeneration(ctx.model))) {
		const imagegen = createImageGenerationTool({
			promptSnippet: false,
			customRendering: runtime.state.config.ui.toolRenaming,
		});
		tools.push(toNestedTool(
			{ ...imagegen, name: "image_gen__imagegen", label: "image_gen__imagegen" },
			"await tools.image_gen__imagegen({ prompt: string, action?: \"generate\" | \"edit\", images?: string[] })",
			{},
			{
				resultValue(result) {
					const outputHint = result.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n") || undefined;
					return codeModeImageResult(result, outputHint);
				},
			},
		));
	}
	return tools;
}

function toNestedTool<TParams extends TSchema, TDetails, TState>(
	tool: ToolDefinition<TParams, TDetails, TState>,
	usage: string,
	lifecycle: {
		start?(id: string, input: unknown): void;
		end?(id: string): void;
	} = {},
	contract: {
		kind?: "function" | "freeform";
		prepareInput?(input: unknown): unknown;
		resultError?(result: AgentToolResult<unknown>): string | undefined;
		resultValue?(result: AgentToolResult<unknown>): unknown;
	} = {},
): ProgrammaticCodeModeToolDefinition {
	const kind = contract.kind ?? "function";
	const prepareInput = (input: unknown) =>
		contract.prepareInput ? contract.prepareInput(input) : input;
	return {
		name: tool.name,
		usage,
		description: tool.description,
		deferLoading: false,
		kind,
		...(kind === "function" ? { inputSchema: tool.parameters } : {}),
		...(tool.renderCall
			? {
				renderCall: (input, theme, context) =>
					tool.renderCall!(prepareInput(input) as never, theme as never, context as never),
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
			const toolInput = prepareInput(input);
			const prepared = tool.prepareArguments
				? tool.prepareArguments(toolInput)
				: toolInput;
			if (signal.aborted) throw new Error(`${tool.name} aborted`);
			const toolCallId = context.toolCallId ?? `code-mode-${tool.name}`;
			lifecycle.start?.(toolCallId, prepared);
			context.refreshTrace?.();
			try {
				const result = await tool.execute(
					toolCallId,
					prepared as never,
					signal,
					(update) => forwardUpdate(update, context),
					extensionContext,
				);
				context.captureResult?.(result);
				const resultError = contract.resultError?.(result);
				if (resultError) throw new Error(resultError);
				return contract.resultValue?.(result) ?? compactNestedResult(result);
			} finally {
				lifecycle.end?.(toolCallId);
			}
		},
	};
}

function codeModeImageResult(
	result: AgentToolResult<unknown>,
	outputHint?: string,
): unknown {
	const image = result.content.find((item) => item.type === "image");
	if (!image || image.type !== "image") return compactNestedResult(result);
	const detail = "detail" in image && typeof image.detail === "string"
		? image.detail
		: "high";
	return {
		image_url: `data:${image.mimeType};base64,${image.data}`,
		detail,
		...(outputHint ? { output_hint: outputHint } : {}),
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
