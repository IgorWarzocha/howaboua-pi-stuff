import { calculateCost, type Api, type AssistantMessage, type Context, type Model, type Tool, type Usage } from "@earendil-works/pi-ai";
import type { ResponseCreateParamsStreaming, ResponseInput, ResponseStreamEvent, Tool as OpenAITool } from "openai/resources/responses/responses.js";
import { parse as partialParse } from "partial-json";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";

type Message = Context["messages"][number];

interface ImageGenerationCallItem {
	type: "image_generation_call";
	id: string;
	status: string;
	result: string | null;
	revised_prompt?: string | undefined;
}

interface ImageGenerationCallBlock {
	type: "image_generation_call";
	item: ImageGenerationCallItem;
}

type InternalAssistantContent = Extract<Message, { role: "assistant" }>["content"][number] | ImageGenerationCallBlock;

export interface OpenAIResponsesStreamOptions {
	serviceTier?: ResponseCreateParamsStreaming["service_tier"] | undefined;
	resolveServiceTier?: (
		responseServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
		requestServiceTier: ResponseCreateParamsStreaming["service_tier"] | undefined,
	) => ResponseCreateParamsStreaming["service_tier"] | undefined;
	applyServiceTierPricing?: (usage: Usage, serviceTier: ResponseCreateParamsStreaming["service_tier"] | undefined) => void;
}

type TextSignaturePhase = "commentary" | "final_answer";

interface ConvertResponsesMessagesOptions {
	includeSystemPrompt?: boolean | undefined;
}

interface ConvertResponsesToolsOptions {
	strict?: boolean | null | undefined;
}

export const CODEX_TOOL_CALL_PROVIDERS = new Set(["openai", "openai-codex", "opencode"]);

function shortHash(str: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < str.length; i++) {
		const ch = str.charCodeAt(i);
		h1 = Math.imul(h1 ^ ch, 2654435761);
		h2 = Math.imul(h2 ^ ch, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}

function parseStreamingJson(partialJson: string): Record<string, unknown> {
	if (!partialJson || partialJson.trim() === "") return {};
	try {
		return JSON.parse(partialJson) as Record<string, unknown>;
	} catch {
		try {
			return (partialParse(partialJson) ?? {}) as Record<string, unknown>;
		} catch {
			return {};
		}
	}
}

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "");
}

function isImageGenerationCallBlock(block: InternalAssistantContent): block is ImageGenerationCallBlock {
	return block.type === "image_generation_call" && block.item?.type === "image_generation_call";
}

function sanitizeImageGenerationCallItem(item: unknown): ImageGenerationCallItem | undefined {
	if (!item || typeof item !== "object") return undefined;
	const candidate = item as Record<string, unknown>;
	if (candidate["type"] !== "image_generation_call") return undefined;
	if (typeof candidate["id"]! !== "string" || candidate["id"] === "") return undefined;
	if (typeof candidate["status"]! !== "string" || candidate["status"] === "") return undefined;
	if (!(typeof candidate["result"]! === "string" || candidate["result"] === null)) return undefined;

	return {
		type: "image_generation_call",
		id: candidate["id"]!,
		status: candidate["status"]!,
		result: candidate["result"]!,
		...(typeof candidate["revised_prompt"]! === "string" ? { revised_prompt: candidate["revised_prompt"]! } : {}),
	};
}

const NON_VISION_USER_IMAGE_PLACEHOLDER = "(image omitted: model does not support images)";
const NON_VISION_TOOL_IMAGE_PLACEHOLDER = "(tool image omitted: model does not support images)";

function replaceImagesWithPlaceholder(
	content: Extract<Message, { role: "user" }> extends { content: infer T } ? Exclude<T, string> : never,
	placeholder: string,
) {
	const result: Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> = [];
	let previousWasPlaceholder = false;
	for (const block of content) {
		if (block.type === "image") {
			if (!previousWasPlaceholder) {
				result.push({ type: "text", text: placeholder });
			}
			previousWasPlaceholder = true;
			continue;
		}
		result.push(block);
		previousWasPlaceholder = block.text === placeholder;
	}
	return result;
}

function downgradeUnsupportedImages(messages: Context["messages"], model: Model<Api>): Context["messages"] {
	if (model.input.includes("image")) return messages;
	return messages.map((msg) => {
		if (msg.role === "user" && Array.isArray(msg.content)) {
			return { ...msg, content: replaceImagesWithPlaceholder(msg.content, NON_VISION_USER_IMAGE_PLACEHOLDER) };
		}
		if (msg.role === "toolResult") {
			return { ...msg, content: replaceImagesWithPlaceholder(msg.content, NON_VISION_TOOL_IMAGE_PLACEHOLDER) };
		}
		return msg;
	});
}

function transformMessages(
	messages: Context["messages"],
	model: Model<Api>,
	normalizeToolCallId?: (id: string, targetModel: Model<Api>, source: Extract<Message, { role: "assistant" }>) => string,
): Context["messages"] {
	const toolCallIdMap = new Map<string, string>();
	const imageAwareMessages = downgradeUnsupportedImages(messages, model);
	const transformed = imageAwareMessages.map((msg) => {
		if (msg.role === "user") return msg;
		if (msg.role === "toolResult") {
			const normalizedId = toolCallIdMap.get(msg.toolCallId);
			return normalizedId && normalizedId !== msg.toolCallId ? { ...msg, toolCallId: normalizedId } : msg;
		}
		if (msg.role === "assistant") {
			const assistantMsg = msg;
			const isSameModel =
				assistantMsg.provider === model.provider && assistantMsg.api === model.api && assistantMsg.model === model.id;
			const transformedContent = (assistantMsg.content as InternalAssistantContent[]).flatMap((block) => {
				if (isImageGenerationCallBlock(block)) return block;
				if (block.type === "thinking") {
					if (block.redacted) return isSameModel ? block : [];
					if (isSameModel && block.thinkingSignature) return block;
					if (!block.thinking || block.thinking.trim() === "") return [];
					return isSameModel ? block : { type: "text" as const, text: block.thinking };
				}
				if (block.type === "text") return isSameModel ? block : { type: "text" as const, text: block.text };
				if (block.type === "toolCall") {
					let normalizedToolCall = block;
					if (!isSameModel && block.thoughtSignature) {
						normalizedToolCall = { ...block };
						delete normalizedToolCall.thoughtSignature;
					}
					if (!isSameModel && normalizeToolCallId) {
						const normalizedId = normalizeToolCallId(block.id, model, assistantMsg);
						if (normalizedId !== block.id) {
							toolCallIdMap.set(block.id, normalizedId);
							normalizedToolCall = { ...normalizedToolCall, id: normalizedId };
						}
					}
					return normalizedToolCall;
				}
				return block;
			});
			return { ...assistantMsg, content: transformedContent as Extract<Message, { role: "assistant" }>["content"] };
		}
		return msg;
	});

	const result: Context["messages"] = [];
	let pendingToolCalls: Array<Extract<Extract<Message, { role: "assistant" }>["content"][number], { type: "toolCall" }>> = [];
	let existingToolResultIds = new Set<string>();

	const insertSyntheticToolResults = () => {
		if (pendingToolCalls.length === 0) return;
		for (const toolCall of pendingToolCalls) {
			if (!existingToolResultIds.has(toolCall.id)) {
				result.push({
					role: "toolResult",
					toolCallId: toolCall.id,
					toolName: toolCall.name,
					content: [{ type: "text", text: "No result provided" }],
					isError: true,
					timestamp: Date.now(),
				});
			}
		}
		pendingToolCalls = [];
		existingToolResultIds = new Set();
	};

	for (const msg of transformed) {
		if (msg.role === "assistant") {
			insertSyntheticToolResults();
			if (msg.stopReason === "error" || msg.stopReason === "aborted") continue;
			const toolCalls = msg.content.filter((block) => block.type === "toolCall");
			if (toolCalls.length > 0) {
				pendingToolCalls = toolCalls;
				existingToolResultIds = new Set();
			}
			result.push(msg);
			continue;
		}
		if (msg.role === "toolResult") {
			existingToolResultIds.add(msg.toolCallId);
			result.push(msg);
			continue;
		}
		if (msg.role === "user") {
			insertSyntheticToolResults();
			result.push(msg);
			continue;
		}
		result.push(msg);
	}

	insertSyntheticToolResults();

	return result;
}

function encodeTextSignatureV1(id: string, phase?: string): string {
	const payload: { v: 1; id: string; phase?: string | undefined } = { v: 1, id };
	if (phase) payload.phase = phase;
	return JSON.stringify(payload);
}

function parseTextSignature(signature: string | undefined): { id: string; phase?: TextSignaturePhase | undefined } | undefined {
	if (!signature) return undefined;
	if (signature.startsWith("{")) {
		try {
			const parsed = JSON.parse(signature) as { v?: number | undefined; id?: string | undefined; phase?: TextSignaturePhase | string | undefined };
			if (parsed.v === 1 && typeof parsed.id === "string") {
				return parsed.phase === "commentary" || parsed.phase === "final_answer"
					? { id: parsed.id, phase: parsed.phase }
					: { id: parsed.id };
			}
		} catch {
			// Fall through to legacy plain-string handling.
		}
	}
	return { id: signature };
}

export function convertResponsesMessages<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	allowedToolCallProviders: ReadonlySet<string>,
	options?: ConvertResponsesMessagesOptions,
): ResponseInput {
	const messages: ResponseInput = [];
	const normalizeIdPart = (part: string) => {
		const sanitized = part.replace(/[^a-zA-Z0-9_-]/g, "_");
		const normalized = sanitized.length > 64 ? sanitized.slice(0, 64) : sanitized;
		return normalized.replace(/_+$/, "");
	};
	const buildForeignResponsesItemId = (itemId: string) => {
		const normalized = `fc_${shortHash(itemId)}`;
		return normalized.length > 64 ? normalized.slice(0, 64) : normalized;
	};
	const normalizeToolCallId = (id: string, _targetModel: Model<TApi>, source: Extract<Message, { role: "assistant" }>) => {
		if (!allowedToolCallProviders.has(model.provider)) return normalizeIdPart(id);
		if (!id.includes("|")) return normalizeIdPart(id);
		const [callId, itemId] = id.split("|") as [string, string | undefined];
		const normalizedCallId = normalizeIdPart(callId);
		const isForeignToolCall = source.provider !== model.provider || source.api !== model.api;
		let normalizedItemId = isForeignToolCall ? buildForeignResponsesItemId(itemId ?? "") : normalizeIdPart(itemId ?? "");
		if (!normalizedItemId.startsWith("fc_")) normalizedItemId = normalizeIdPart(`fc_${normalizedItemId}`);
		return `${normalizedCallId}|${normalizedItemId}`;
	};

	const transformedMessages = transformMessages(context.messages, model as Model<Api>, normalizeToolCallId as never);
	const includeSystemPrompt = options?.includeSystemPrompt ?? true;
	if (includeSystemPrompt && context.systemPrompt) {
		messages.push({ role: model.reasoning ? "developer" : "system", content: sanitizeSurrogates(context.systemPrompt) });
	}

	let msgIndex = 0;
	for (const msg of transformedMessages) {
		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				messages.push({ role: "user", content: [{ type: "input_text", text: sanitizeSurrogates(msg.content) }] });
			} else {
				const content = msg.content.map((item) =>
					item.type === "text"
						? { type: "input_text" as const, text: sanitizeSurrogates(item.text) }
						: { type: "input_image" as const, detail: "auto" as const, image_url: `data:${item.mimeType};base64,${item.data}` },
				);
				if (content.length > 0) messages.push({ role: "user", content });
			}
		} else if (msg.role === "assistant") {
			const output: ResponseInput = [];
			const isDifferentModel = msg.model !== model.id && msg.provider === model.provider && msg.api === model.api;
			let textBlockIndex = 0;
			for (const block of msg.content as InternalAssistantContent[]) {
				if (isImageGenerationCallBlock(block)) {
					const imageGenerationCall = sanitizeImageGenerationCallItem(block.item);
					if (imageGenerationCall) output.push(imageGenerationCall as ResponseInput[number]);
				} else if (block.type === "thinking") {
					if (block.thinkingSignature) output.push(JSON.parse(block.thinkingSignature));
				} else if (block.type === "text") {
					const parsedSignature = parseTextSignature(block.textSignature);
					const fallbackMessageId = textBlockIndex === 0 ? `msg_pi_${msgIndex}` : `msg_pi_${msgIndex}_${textBlockIndex}`;
					textBlockIndex++;
					let msgId = parsedSignature?.id ?? fallbackMessageId;
					if (msgId.length > 64) msgId = `msg_${shortHash(msgId)}`;
					output.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: sanitizeSurrogates(block.text), annotations: [] }],
						status: "completed",
						id: msgId,
						...(parsedSignature?.phase ? { phase: parsedSignature.phase } : {}),
					});
				} else if (block.type === "toolCall") {
					const [callId, itemIdRaw] = block.id.split("|");
					let itemId: string | undefined = itemIdRaw;
					if (isDifferentModel && itemId?.startsWith("fc_")) itemId = undefined;
					output.push({
						type: "function_call",
						...(itemId ? { id: itemId } : {}),
						call_id: callId,
						name: block.name,
						arguments: JSON.stringify(block.arguments),
					} as ResponseInput[number]);
				}
			}
			if (output.length > 0) messages.push(...output);
		} else if (msg.role === "toolResult") {
			const textResult = msg.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
			const hasImages = msg.content.some((c) => c.type === "image");
			const hasText = textResult.length > 0;
			const [callId] = msg.toolCallId.split("|");
			const output = hasImages && model.input.includes("image")
				? [
						...(hasText ? [{ type: "input_text" as const, text: sanitizeSurrogates(textResult) }] : []),
						...msg.content
							.filter((block) => block.type === "image")
							.map((block) => ({
								type: "input_image" as const,
								detail: "auto" as const,
								image_url: `data:${block.mimeType};base64,${block.data}`,
							})),
					]
				: sanitizeSurrogates(hasText ? textResult : "(see attached image)");
			messages.push({ type: "function_call_output", call_id: callId!, output });
		}
		msgIndex++;
	}

	return messages;
}

export function convertResponsesTools(tools: Tool[], options?: ConvertResponsesToolsOptions): OpenAITool[] {
	const strict = options?.strict === undefined ? false : options.strict;
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description,
		parameters: tool.parameters as unknown as Record<string, unknown>,
		strict,
	}));
}

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<ResponseStreamEvent>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void> {
	const blocks = output.content;
	const blockIndex = () => blocks.length - 1;
	type ThinkingBlock = Extract<AssistantMessage["content"][number], { type: "thinking" }>;
	type TextBlock = Extract<AssistantMessage["content"][number], { type: "text" }>;
	type ToolCallBlock = Extract<AssistantMessage["content"][number], { type: "toolCall" }> & { partialJson?: string | undefined };

	type ReasoningState = {
		kind: "reasoning";
		blockIndex: number;
		block: ThinkingBlock;
		summaryParts: Map<number, { text: string }>;
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
	type OutputState = ReasoningState | MessageState | FunctionCallState;

	const outputStates = new Map<number, OutputState>();

	const renderReasoningSummary = (summaryParts: Map<number, { text: string }>): string =>
		Array.from(summaryParts.entries())
			.sort(([a], [b]) => a - b)
			.map(([, part]) => part.text)
			.join("\n\n");

	const renderMessageText = (parts: Map<number, { type: "output_text" | "refusal"; text: string }>): string =>
		Array.from(parts.entries())
			.sort(([a], [b]) => a - b)
			.map(([, part]) => part.text)
			.join("");

	const emitAppendedDelta = (
		eventType: "thinking_delta" | "text_delta",
		contentIndex: number,
		previous: string,
		next: string,
	) => {
		if (next.startsWith(previous)) {
			const delta = next.slice(previous.length);
			if (delta.length > 0) {
				stream.push({ type: eventType, contentIndex, delta, partial: output });
			}
		}
	};

	for await (const event of openaiStream) {
		if (event.type === "response.created") {
			output.responseId = event.response.id;
		} else if (event.type === "response.output_item.added") {
			const item = event.item;
			if (item.type === "reasoning") {
				const currentBlock: ThinkingBlock = { type: "thinking", thinking: "" };
				output.content.push(currentBlock);
				outputStates.set(event.output_index, {
					kind: "reasoning",
					blockIndex: blockIndex(),
					block: currentBlock,
					summaryParts: new Map(),
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
				const currentBlock: ToolCallBlock = {
					type: "toolCall",
					id: `${item.call_id}|${item.id}`,
					name: item.name,
					arguments: {},
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
		} else if (event.type === "response.reasoning_summary_part.added") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "reasoning") {
				state.summaryParts.set(event.summary_index, { text: event.part.text });
			}
		} else if (event.type === "response.reasoning_summary_text.delta") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "reasoning") {
				const summaryPart = state.summaryParts.get(event.summary_index) ?? { text: "" };
				summaryPart.text += event.delta;
				state.summaryParts.set(event.summary_index, summaryPart);
				const previousThinking = state.block.thinking;
				const nextThinking = renderReasoningSummary(state.summaryParts);
				state.block.thinking = nextThinking;
				emitAppendedDelta("thinking_delta", state.blockIndex, previousThinking, nextThinking);
			}
		} else if (event.type === "response.reasoning_summary_part.done") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "reasoning") {
				state.summaryParts.set(event.summary_index, { text: event.part.text });
				state.block.thinking = renderReasoningSummary(state.summaryParts);
			}
		} else if (event.type === "response.content_part.added") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "message" && (event.part.type === "output_text" || event.part.type === "refusal")) {
				state.parts.set(event.content_index, {
					type: event.part.type,
					text: event.part.type === "output_text" ? event.part.text : event.part.refusal,
				});
			}
		} else if (event.type === "response.output_text.delta") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "message") {
				const messagePart = state.parts.get(event.content_index) ?? { type: "output_text" as const, text: "" };
				if (messagePart.type === "output_text") {
					messagePart.text += event.delta;
					state.parts.set(event.content_index, messagePart);
					const previousText = state.block.text;
					const nextText = renderMessageText(state.parts);
					state.block.text = nextText;
					emitAppendedDelta("text_delta", state.blockIndex, previousText, nextText);
				}
			}
		} else if (event.type === "response.refusal.delta") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "message") {
				const messagePart = state.parts.get(event.content_index) ?? { type: "refusal" as const, text: "" };
				if (messagePart.type === "refusal") {
					messagePart.text += event.delta;
					state.parts.set(event.content_index, messagePart);
					const previousText = state.block.text;
					const nextText = renderMessageText(state.parts);
					state.block.text = nextText;
					emitAppendedDelta("text_delta", state.blockIndex, previousText, nextText);
				}
			}
		} else if (event.type === "response.function_call_arguments.delta") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "function_call") {
				state.block.partialJson = (state.block.partialJson ?? "") + event.delta;
				state.block.arguments = parseStreamingJson(state.block.partialJson ?? "");
				stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
			}
		} else if (event.type === "response.function_call_arguments.done") {
			const state = outputStates.get(event.output_index);
			if (state?.kind === "function_call") {
				const previousPartialJson = state.block.partialJson ?? "";
				state.block.partialJson = event.arguments;
				state.block.arguments = parseStreamingJson(state.block.partialJson ?? "");
				if (event.arguments.startsWith(previousPartialJson)) {
					const delta = event.arguments.slice(previousPartialJson.length);
					if (delta.length > 0) {
						stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
					}
				}
			}
		} else if (event.type === "response.output_item.done") {
			const item = event.item;
			if (item.type === "reasoning") {
				let state = outputStates.get(event.output_index);
				if (!state || state.kind !== "reasoning") {
					const currentBlock: ThinkingBlock = { type: "thinking", thinking: "" };
					output.content.push(currentBlock);
					state = { kind: "reasoning", blockIndex: blockIndex(), block: currentBlock, summaryParts: new Map() };
					outputStates.set(event.output_index, state);
				}
				state.block.thinking = item.summary?.map((summary) => summary.text).join("\n\n") || "";
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
				}
				state.block.text = item.content.map((content) => (content.type === "output_text" ? content.text : content.refusal)).join("");
				state.block.textSignature = encodeTextSignatureV1(item.id, item.phase ?? undefined);
				stream.push({ type: "text_end", contentIndex: state.blockIndex, content: state.block.text, partial: output });
				outputStates.delete(event.output_index);
			} else if (item.type === "function_call") {
				const state = outputStates.get(event.output_index);
				const args = state?.kind === "function_call" && state.block.partialJson
					? parseStreamingJson(state.block.partialJson)
					: parseStreamingJson(item.arguments || "{}");
				const toolCall = state?.kind === "function_call"
					? (() => {
						state.block.arguments = args;
						delete state.block.partialJson;
						return state.block;
					})()
					: (() => {
						const fallbackToolCall: ToolCallBlock = {
							type: "toolCall",
							id: `${item.call_id}|${item.id}`,
							name: item.name,
							arguments: args,
						};
						output.content.push(fallbackToolCall);
						return fallbackToolCall;
					})();
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
			}
		} else if (event.type === "response.completed") {
			const response = event.response;
			if (response?.id) output.responseId = response.id;
			if (response?.usage) {
				const cachedTokens = response.usage.input_tokens_details?.cached_tokens || 0;
				output.usage = {
					input: (response.usage.input_tokens || 0) - cachedTokens,
					output: response.usage.output_tokens || 0,
					cacheRead: cachedTokens,
					cacheWrite: 0,
					totalTokens: response.usage.total_tokens || 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			}
			calculateCost(model, output.usage);
			if (options?.applyServiceTierPricing) {
				const serviceTier = options.resolveServiceTier
					? options.resolveServiceTier(response?.service_tier, options.serviceTier)
					: (response?.service_tier ?? options.serviceTier);
				options.applyServiceTierPricing(output.usage, serviceTier);
			}
			output.stopReason = mapStopReason(response?.status);
			if (output.content.some((block) => block.type === "toolCall") && output.stopReason === "stop") {
				output.stopReason = "toolUse";
			}
		} else if (event.type === "error") {
			const details = [event.code, event.message].filter(Boolean).join(": ");
			throw new Error(details || "Unknown error");
		} else if (event.type === "response.failed") {
			const error = event.response?.error;
			const details = (event.response as { incomplete_details?: { reason?: string | undefined } | undefined } | undefined)?.incomplete_details;
			const msg = error
				? `${error.code || "unknown"}: ${error.message || "no message"}`
				: details?.reason
					? `incomplete: ${details.reason}`
					: "Unknown error (no error details in response)";
			throw new Error(msg);
		}
	}
}

function mapStopReason(status: string | undefined): AssistantMessage["stopReason"] {
	if (!status) return "stop";
	switch (status) {
		case "completed":
			return "stop";
		case "incomplete":
			return "length";
		case "failed":
		case "cancelled":
			return "error";
		case "in_progress":
		case "queued":
			return "stop";
		default:
			throw new Error(`Unhandled stop reason: ${status}`);
	}
}
