import { parseToolCallArguments, type AssistantMessage, type AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { GrammarToolInputJsonBuffer } from "../../constrained-sampling.js";
import { encodeTextSignatureV1 } from "../signatures.ts";
import { sanitizeImageGenerationCallItem, sanitizeWebSearchCallItem, type ImageGenerationCallBlock, type WebSearchCallBlock, type ResponsesToolCall } from "../native-items.ts";
import type { OpenAIResponsesStreamOptions } from "../shared.ts";
import { appendCustomInput } from "./tool-deltas.ts";

type InternalAssistantContent = AssistantMessage["content"][number] | ImageGenerationCallBlock | WebSearchCallBlock;

type ThinkingBlock = Extract<AssistantMessage["content"][number], { type: "thinking" }>;
type TextBlock = Extract<AssistantMessage["content"][number], { type: "text" }>;
type ToolCallBlock = ResponsesToolCall & { partialJson?: string | undefined };

type ReasoningState = {
	kind: "reasoning";
	blockIndex: number;
	block: ThinkingBlock;
	summaryParts: Map<number, { text: string }>;
	contentParts: Map<number, { text: string }>;
};
type MessageState = {
	kind: "message";
	blockIndex: number;
	block: TextBlock;
	parts: Map<number, { type: "output_text" | "refusal"; text: string }>;
};
type FunctionCallState = {
	kind: "function_call";
	blockIndex: number;
	block: ToolCallBlock;
};
export type CustomToolCallState = {
	kind: "custom_tool_call";
	blockIndex: number;
	block: ToolCallBlock;
	input: string;
	property: string;
	jsonBuffer: GrammarToolInputJsonBuffer;
};
export type OutputState = ReasoningState | MessageState | FunctionCallState | CustomToolCallState;
export interface ResponsesStreamOutput {
	output: AssistantMessage;
	stream: Pick<AssistantMessageEventStream, "push">;
	outputStates: Map<number, OutputState>;
	options: OpenAIResponsesStreamOptions | undefined;
}

export function startResponsesOutputItem(event: Extract<ResponseStreamEvent, { type: "response.output_item.added" }>, state: ResponsesStreamOutput): void {
	const { output, stream, outputStates, options } = state;
	const blockIndex = () => output.content.length - 1;
	const item = event.item;
	if ((item as unknown as { type?: string }).type === "custom_tool_call") {
		const customItem = item as unknown as { id?: string; call_id: string; name: string; input?: string; namespace?: string };
		const input = customItem.input ?? "";
		const property = options?.grammarToolInputProperties?.get(customItem.name) ?? "input";
		const currentBlock: ToolCallBlock = {
			type: "toolCall",
			id: `${customItem.call_id}|${customItem.id ?? ""}`,
			name: customItem.name,
			arguments: { [property]: input },
			responsesCustomInputProperty: property,
			...(customItem.namespace !== undefined ? { namespace: customItem.namespace } : {}),
		};
		output.content.push(currentBlock);
		outputStates.set(event.output_index, {
			kind: "custom_tool_call",
			blockIndex: blockIndex(),
			block: currentBlock,
			input,
			property,
			jsonBuffer: { input: "", started: false, closed: false },
		});
		stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
	} else if (item.type === "reasoning") {
		const currentBlock: ThinkingBlock = { type: "thinking", thinking: "" };
		output.content.push(currentBlock);
		outputStates.set(event.output_index, {
			kind: "reasoning",
			blockIndex: blockIndex(),
			block: currentBlock,
			summaryParts: new Map(),
			contentParts: new Map(),
		});
		stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
	} else if (item.type === "message") {
		const currentBlock: TextBlock = { type: "text", text: "" };
		output.content.push(currentBlock);
		outputStates.set(event.output_index, {
			kind: "message",
			blockIndex: blockIndex(),
			block: currentBlock,
			parts: new Map(),
		});
		stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
	} else if (item.type === "function_call") {
		const namespace = (item as unknown as { namespace?: string }).namespace;
		const currentBlock: ToolCallBlock = {
			type: "toolCall",
			id: `${item.call_id}|${item.id ?? ""}`,
			name: item.name,
			arguments: {},
			...(namespace !== undefined ? { namespace } : {}),
			partialJson: item.arguments || "",
		};
		output.content.push(currentBlock);
		outputStates.set(event.output_index, {
			kind: "function_call",
			blockIndex: blockIndex(),
			block: currentBlock,
		});
		stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
	}
}

export function finishResponsesOutputItem(event: Extract<ResponseStreamEvent, { type: "response.output_item.done" }>, state: ResponsesStreamOutput): void {
	const { output, stream, outputStates, options } = state;
	const blockIndex = () => output.content.length - 1;
	const item = event.item;
	const customItem = (item as unknown as { type?: string }).type === "custom_tool_call"
		? item as unknown as { type: "custom_tool_call"; id?: string; call_id: string; name: string; input?: string; namespace?: string }
		: undefined;
	const customState = customItem ? outputStates.get(event.output_index) : undefined;
	const customInput = customItem?.input ?? (customState?.kind === "custom_tool_call" ? customState.input : "");
	options?.onOutputItemDone?.(customItem ? { ...customItem, input: customInput } : item);
	if (customItem) {
		const state = customState;
		if (state?.kind === "custom_tool_call") {
			const delta = appendCustomInput(state, customInput, true);
			if (delta !== undefined) stream.push({
				type: "toolcall_delta",
				contentIndex: state.blockIndex,
				delta,
				partial: output,
			});
		}
		const property = state?.kind === "custom_tool_call"
			? state.property
			: options?.grammarToolInputProperties?.get(customItem.name) ?? "input";
		const toolCall: ToolCallBlock = state?.kind === "custom_tool_call"
			? { ...state.block, arguments: { [property]: customInput }, ...(customItem.namespace !== undefined ? { namespace: customItem.namespace } : {}) }
			: { type: "toolCall", id: `${customItem.call_id}|${customItem.id ?? ""}`, name: customItem.name, arguments: { [property]: customInput },
				responsesCustomInputProperty: property, ...(customItem.namespace !== undefined ? { namespace: customItem.namespace } : {}) };
		if (state?.kind !== "custom_tool_call") {
			output.content.push(toolCall);
			stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
		} else output.content[state.blockIndex] = toolCall;
		const toolCallIndex = state?.kind === "custom_tool_call" ? state.blockIndex : blockIndex();
		stream.push({ type: "toolcall_end", contentIndex: toolCallIndex, toolCall, partial: output });
		outputStates.delete(event.output_index);
	} else if (item.type === "reasoning") {
		let state = outputStates.get(event.output_index);
		if (!state || state.kind !== "reasoning") {
			const currentBlock: ThinkingBlock = { type: "thinking", thinking: "" };
			output.content.push(currentBlock);
			state = { kind: "reasoning", blockIndex: blockIndex(), block: currentBlock, summaryParts: new Map(), contentParts: new Map() };
			outputStates.set(event.output_index, state);
			stream.push({ type: "thinking_start", contentIndex: state.blockIndex, partial: output });
		}
		const summaryText = item.summary?.map((summary) => summary.text).join("\n\n") || "";
		const contentText = item.content?.map((content) => content.text).join("\n\n") || "";
		state.block.thinking = summaryText || contentText || state.block.thinking;
		state.block.thinkingSignature = JSON.stringify(item);
		stream.push({ type: "thinking_end", contentIndex: state.blockIndex, content: state.block.thinking, partial: output });
		outputStates.delete(event.output_index);
	} else if (item.type === "message") {
		let state = outputStates.get(event.output_index);
		if (!state || state.kind !== "message") {
			const currentBlock: TextBlock = { type: "text", text: "" };
			output.content.push(currentBlock);
			state = { kind: "message", blockIndex: blockIndex(), block: currentBlock, parts: new Map() };
			outputStates.set(event.output_index, state);
			stream.push({ type: "text_start", contentIndex: state.blockIndex, partial: output });
		}
		state.block.text = item.content.map((content) => (content.type === "output_text" ? content.text : content.refusal)).join("");
		state.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
		stream.push({ type: "text_end", contentIndex: state.blockIndex, content: state.block.text, partial: output });
		outputStates.delete(event.output_index);
	} else if (item.type === "function_call") {
		const state = outputStates.get(event.output_index);
		const namespace = (item as unknown as { namespace?: string }).namespace;
		const parsed = parseToolCallArguments(item.arguments || (state?.kind === "function_call" ? state.block.partialJson : undefined));
		let toolCall: ToolCallBlock;
		if (state?.kind === "function_call") {
			Object.assign(state.block, parsed);
			if (namespace !== undefined) state.block.namespace = namespace;
			delete state.block.partialJson;
			toolCall = state.block;
		} else {
			toolCall = {
				type: "toolCall",
				id: `${item.call_id}|${item.id ?? ""}`,
				name: item.name,
				...parsed,
				...(namespace !== undefined ? { namespace } : {}),
			};
			output.content.push(toolCall);
			stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
		}
		const toolCallIndex = state?.kind === "function_call" ? state.blockIndex : blockIndex();
		stream.push({ type: "toolcall_end", contentIndex: toolCallIndex, toolCall, partial: output });
		outputStates.delete(event.output_index);
	} else if (item.type === "image_generation_call") {
		const imageGenerationCall = sanitizeImageGenerationCallItem(item);
		if (imageGenerationCall) {
			(output.content as InternalAssistantContent[]).push({
				type: "image_generation_call",
				item: imageGenerationCall,
			});
		}
		outputStates.delete(event.output_index);
	} else if (item.type === "web_search_call") {
		const webSearchCall = sanitizeWebSearchCallItem(item);
		if (webSearchCall) {
			(output.content as InternalAssistantContent[]).push({
				type: "web_search_call",
				item: webSearchCall,
			});
		}
		outputStates.delete(event.output_index);
	}
}
