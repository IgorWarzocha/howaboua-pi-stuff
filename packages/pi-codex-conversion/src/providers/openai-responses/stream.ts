import { calculateCost, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { parse as partialParse } from "partial-json";
import type { AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { encodeTextSignatureV1 } from "./signatures.ts";
import { sanitizeImageGenerationCallItem, sanitizeWebSearchCallItem, type ImageGenerationCallBlock, type WebSearchCallBlock } from "./native-items.ts";
import type { OpenAIResponsesStreamOptions } from "./shared.ts";

type InternalAssistantContent = AssistantMessage["content"][number] | ImageGenerationCallBlock | WebSearchCallBlock;

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
