import type { Api, AssistantMessage, AssistantMessageEventStream, Model } from "@earendil-works/pi-ai";
import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import type { OpenAIResponsesStreamOptions } from "./shared.ts";
import { startResponsesOutputItem, finishResponsesOutputItem, type OutputState } from "./stream/output-items.ts";
import { applyResponsesToolDelta } from "./stream/tool-deltas.ts";
import { applyResponsesContentDelta } from "./stream/content-deltas.ts";
import { completeResponsesOutput } from "./stream/completion.ts";

export async function processResponsesStream<TApi extends Api>(
	openaiStream: AsyncIterable<ResponseStreamEvent>,
	output: AssistantMessage,
	stream: Pick<AssistantMessageEventStream, "push">,
	model: Model<TApi>,
	options?: OpenAIResponsesStreamOptions,
): Promise<void> {
	const outputStates = new Map<number, OutputState>();
	const completedToolCallIds = new Set<string>();
	const rejectToolCalls = (message: string) => {
		output.stopReason = "error";
		output.errorMessage = `Invalid Responses tool stream: ${message}`;
	};
	const state = { output, stream, outputStates, options };

	const cleanedStream = async function* () {
		try {
			yield* openaiStream;
		} finally {
			const incompleteToolCallIndexes = [...outputStates.values()]
				.filter((state) => state.kind === "function_call" || state.kind === "custom_tool_call")
				.map((state) => state.blockIndex)
				.sort((left, right) => right - left);
			for (const index of incompleteToolCallIndexes) output.content.splice(index, 1);
		}
	}();

	for await (const event of cleanedStream) {
		if (event.type === "response.output_item.added" || event.type === "response.output_item.done") {
			const item = event.item;
			const state = outputStates.get(event.output_index);
			if (event.type === "response.output_item.added" ? state !== undefined : state && state.kind !== item.type) {
				rejectToolCalls("conflicting output items");
				return;
			}
			if (item.type === "function_call" || item.type === "custom_tool_call") {
				if (!Number.isInteger(event.output_index) || event.output_index < 0) {
					rejectToolCalls("missing or invalid output_index");
					return;
				}
				if (completedToolCallIds.has(item.call_id) ||
					((state?.kind === "function_call" || state?.kind === "custom_tool_call") &&
						(state.block.id !== `${item.call_id}|${item.id ?? ""}` || state.block.name !== item.name))) {
					rejectToolCalls("duplicate or mismatched tool call");
					return;
				}
				if (event.type === "response.output_item.done") completedToolCallIds.add(item.call_id);
			}
		}
		if (applyResponsesToolDelta(event, state) || applyResponsesContentDelta(event, state)) continue;
		if (event.type === "response.created") {
			output.responseId = event.response.id;
		} else if (event.type === "response.output_item.added") {
			startResponsesOutputItem(event, state);
		} else if (event.type === "response.output_item.done") {
			finishResponsesOutputItem(event, state);
		} else if (event.type === "response.completed" || event.type === "response.incomplete") {
			completeResponsesOutput(event, state, model);
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
