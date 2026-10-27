import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { ResponsesStreamOutput } from "./output-items.ts";

const renderReasoningParts = (parts: Map<number, { text: string }>): string =>
	Array.from(parts.entries())
		.sort(([a], [b]) => a - b)
		.map(([, part]) => part.text)
		.join("\n\n");

const renderMessageText = (parts: Map<number, { type: "output_text" | "refusal"; text: string }>): string =>
	Array.from(parts.entries())
		.sort(([a], [b]) => a - b)
		.map(([, part]) => part.text)
		.join("");

export function applyResponsesContentDelta(event: ResponseStreamEvent, state: ResponsesStreamOutput): boolean {
	const { output, stream, outputStates } = state;
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
	if (event.type === "response.reasoning_summary_part.added") {
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
			const nextThinking = renderReasoningParts(state.summaryParts);
			state.block.thinking = nextThinking;
			emitAppendedDelta("thinking_delta", state.blockIndex, previousThinking, nextThinking);
		}
	} else if (event.type === "response.reasoning_summary_part.done") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "reasoning") {
			state.summaryParts.set(event.summary_index, { text: event.part.text });
			state.block.thinking = renderReasoningParts(state.summaryParts);
		}
	} else if (event.type === "response.reasoning_text.delta") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "reasoning") {
			const contentPart = state.contentParts.get(event.content_index) ?? { text: "" };
			contentPart.text += event.delta;
			state.contentParts.set(event.content_index, contentPart);
			const previousThinking = state.block.thinking;
			const nextThinking = renderReasoningParts(state.contentParts);
			state.block.thinking = nextThinking;
			emitAppendedDelta("thinking_delta", state.blockIndex, previousThinking, nextThinking);
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
	} else return false;
	return true;
}
