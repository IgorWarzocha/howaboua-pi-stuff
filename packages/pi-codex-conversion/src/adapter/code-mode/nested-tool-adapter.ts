import type {
	AgentToolResult,
	ExtensionContext,
	ExtensionToolContext,
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
	textOutput?: "command" | "plain-command";
	blocking?: boolean;
	isBlocking?(input: unknown): boolean;
	deferLoading?: boolean;
	discoverWhenDeferred?: boolean;
	modelVisibleResult?: boolean;
	propagateTermination?: boolean;
	opaqueResult?: boolean;
	opaqueResultScope?(result: AgentToolResult<unknown>): string | undefined;
	isContextNoteWrite?(input: unknown): boolean;
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
		if (contract.opaqueResult && !context.captureOpaqueResult)
			throw new Error("Remote result delivery is unavailable; do not execute this operation");
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
			if (contract.opaqueResult && (!context.opaqueScope ||
				!context.opaqueContextValid || !await context.opaqueContextValid()))
				throw new Error("Remote context changed before dispatch; start a new exec cell");
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
			if (contract.opaqueResult) {
				if (!context.opaqueScope || contract.opaqueResultScope?.(result) !== context.opaqueScope ||
					!context.opaqueContextValid || !await context.opaqueContextValid())
					throw new Error("Remote operation executed in a different context; verify note state before repeating a write");
				const details = result.details as { codexHistoryNotes?: { encrypted_output?: unknown } } | undefined;
				const encrypted = details?.codexHistoryNotes?.encrypted_output;
				if (typeof encrypted !== "string" || !encrypted.trim())
					throw new Error("Remote operation executed but returned no protected output; verify its state before repeating a write");
				const action = prepared && typeof prepared === "object" && "action" in prepared && typeof prepared.action === "string"
					? `.${prepared.action}` : "";
				context.captureOpaqueResult!({ resultId: toolCallId, name: tool.name + action, encryptedOutput: encrypted },
					result.content.filter(item => item.type === "image").map(item => ({
						type: "input_image", image_url: `data:${item.mimeType};base64,${item.data}`,
						detail: "detail" in item && (item.detail === "auto" || item.detail === "high" || item.detail === "original")
							? item.detail : "high",
					})));
				context.captureResult?.({ ...result, content: [{ type: "text", text: `Result ${toolCallId}` }], details: {} });
			} else context.captureResult?.(result);
			const resultError = contract.resultError?.(result);
			if (resultError) throw new Error(resultError);
			if (contract.opaqueResult)
				return { result_id: toolCallId };
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
		...(contract.textOutput ? { textOutput: contract.textOutput } : {}),
		...(contract.blocking ? { blocking: true } : {}),
		...(contract.isBlocking ? { isBlocking: contract.isBlocking } : {}),
		...(contract.discoverWhenDeferred ? { discoverWhenDeferred: true } : {}),
		...(contract.translatePromptMetadata ? { translatePromptMetadata: true } : {}),
		...(tool.executionMode ? { executionMode: tool.executionMode } : {}),
		...(contract.propagateTermination ? { propagateTermination: true } : {}),
		...(contract.opaqueResult ? { opaqueResult: true } : {}),
		...(contract.isContextNoteWrite ? { isContextNoteWrite: contract.isContextNoteWrite } : {}),
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
): ExtensionToolContext {
	const ctx = context.extensionContext;
	if (!ctx)
		throw new Error("Code-mode Pi context is unavailable");
	if (isToolContext(ctx)) return ctx;
	// Startup hooks and older hosts have no Pi-owned parent tool call. Leaf tools
	// still work there, but must not pretend nested Pi execution is available.
	const toolContext: ExtensionToolContext = {
		...ctx,
		get tools(): ExtensionToolContext["tools"] {
			throw new Error("Pi nested tools are unavailable outside a tool call");
		},
		async executeTool() {
			throw new Error("Pi nested tools are unavailable outside a tool call");
		},
	};
	// Keep Pi's live getters and stale-context guards rather than their spread values.
	return Object.defineProperties(toolContext, Object.getOwnPropertyDescriptors(ctx));
}

function isToolContext(ctx: ExtensionContext): ctx is ExtensionToolContext {
	return "tools" in ctx && "executeTool" in ctx && typeof ctx.executeTool === "function";
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
