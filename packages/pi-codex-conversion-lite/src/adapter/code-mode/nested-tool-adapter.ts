import type {
	AgentToolResult,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import type {
	ProgrammaticCodeModeToolDefinition,
	ToolExecutionContext,
} from "../../tools/code-mode/types.ts";

interface NestedToolLifecycle {
	start?(id: string, input: unknown): void;
	end?(id: string): void;
}

interface NestedToolContract {
	kind?: "function" | "freeform";
	prepareInput?(input: unknown): unknown;
	resultError?(result: AgentToolResult<unknown>): string | undefined;
	resultValue?(result: AgentToolResult<unknown>): unknown;
}

export function toNestedTool<TParams extends TSchema, TDetails, TState>(
	tool: ToolDefinition<TParams, TDetails, TState>,
	usage: string,
	lifecycle: NestedToolLifecycle = {},
	contract: NestedToolContract = {},
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

export function codeModeImageResult(
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
