import type {
	AgentToolResult,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { TSchema } from "typebox";
import { Check } from "typebox/value";
import type {
	ProgrammaticCodeModeToolDefinition,
	CodeModeToolIdentity,
	ToolExecutionContext,
} from "../../tools/code-mode/types.ts";

interface NestedToolLifecycle {
	start?(id: string, input: unknown): void;
	end?(id: string): void;
}

interface NestedToolContract {
	kind?: "function" | "freeform";
	blocking?: boolean;
	isBlocking?(input: unknown): boolean;
	deferLoading?: boolean;
	discoverWhenDeferred?: boolean;
	modelVisibleResult?: boolean;
	translatePromptMetadata?: boolean;
	toolName?: CodeModeToolIdentity;
	yieldTimeMs?: number;
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
	const invoke = async (
		input: unknown,
		context: ToolExecutionContext,
		signal: AbortSignal,
	): Promise<unknown> => {
		if (signal.aborted) throw new Error(`${tool.name} aborted`);
		const extensionContext = requireExtensionContext(context);
		const toolInput = prepareInput(input);
		const prepared = tool.prepareArguments
			? tool.prepareArguments(toolInput)
			: toolInput;
		if (!Check(tool.parameters, prepared))
			throw new Error(`Invalid ${tool.name} arguments`);
		if (signal.aborted) throw new Error(`${tool.name} aborted`);
		const toolCallId = context.toolCallId ?? `code-mode-${tool.name}`;
		lifecycle.start?.(toolCallId, prepared);
		context.refreshTrace?.();
		let acceptingUpdates = true;
		try {
			const result = await tool.execute(
				toolCallId,
				prepared as never,
				signal,
				(update) => {
					if (acceptingUpdates) forwardUpdate(update, context);
				},
				extensionContext,
			);
			acceptingUpdates = false;
			context.captureResult?.(result);
			const resultError = contract.resultError?.(result);
			if (resultError) throw new Error(resultError);
			return contract.resultValue?.(result) ??
				(contract.modelVisibleResult
					? modelVisibleNestedResult(result)
					: compactNestedResult(result));
		} finally {
			acceptingUpdates = false;
			lifecycle.end?.(toolCallId);
		}
	};
	return {
		name: tool.name,
		usage,
		description: tool.description,
		...(contract.translatePromptMetadata && tool.promptSnippet
			? { promptSnippet: tool.promptSnippet }
			: {}),
		...(contract.translatePromptMetadata && tool.promptGuidelines?.length
			? { promptGuidelines: tool.promptGuidelines }
			: {}),
		deferLoading: contract.deferLoading ?? false,
		kind,
		...(contract.blocking ? { blocking: true } : {}),
		...(contract.isBlocking ? { isBlocking: contract.isBlocking } : {}),
		...(contract.discoverWhenDeferred ? { discoverWhenDeferred: true } : {}),
		...(contract.translatePromptMetadata ? { translatePromptMetadata: true } : {}),
		...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
		...(contract.toolName ? { toolName: contract.toolName } : {}),
		...(contract.yieldTimeMs === undefined ? {} : { yieldTimeMs: contract.yieldTimeMs }),
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
		invoke,
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
	context.onUpdate?.(update);
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

function modelVisibleNestedResult(result: AgentToolResult<unknown>): unknown {
	if (result.content.every((item) => item.type === "text"))
		return result.content.map((item) => item.text).join("\n") || "(no output)";
	return {
		content: result.content.map((item) => ({ ...item })),
	};
}
