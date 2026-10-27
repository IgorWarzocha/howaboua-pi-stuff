import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { parseStreamingJson, type JsonObject } from "@earendil-works/pi-ai";
import { appendGrammarToolInputJsonDelta } from "../../constrained-sampling.js";
import type { CustomToolCallState, ResponsesStreamOutput } from "./output-items.ts";

export function appendCustomInput(
	state: CustomToolCallState,
	nextInput: string,
	close: boolean,
): string | undefined {
	const delta = appendGrammarToolInputJsonDelta(
		state.jsonBuffer,
		state.property,
		nextInput,
		close,
	);
	state.input = nextInput;
	state.block.arguments = { [state.property]: nextInput };
	return delta;
}

export function applyResponsesToolDelta(event: ResponseStreamEvent, state: ResponsesStreamOutput): boolean {
	const { output, stream, outputStates } = state;
	if (event.type === "response.custom_tool_call_input.delta") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "custom_tool_call") {
			const delta = appendCustomInput(state, state.input + event.delta, false);
			if (delta !== undefined) stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
		}
		return true;
	}
	if (event.type === "response.custom_tool_call_input.done") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "custom_tool_call") {
			const delta = appendCustomInput(state, event.input, true);
			if (delta !== undefined) stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
		}
		return true;
	}
	if (event.type === "response.function_call_arguments.delta") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "function_call") {
			state.block.partialJson = (state.block.partialJson ?? "") + event.delta;
			state.block.arguments = parseStreamingJson<JsonObject>(state.block.partialJson);
			stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
		}
	} else if (event.type === "response.function_call_arguments.done") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "function_call") {
			const previousPartialJson = state.block.partialJson ?? "";
			state.block.partialJson = event.arguments;
			state.block.arguments = parseStreamingJson<JsonObject>(state.block.partialJson);
			if (event.arguments.startsWith(previousPartialJson)) {
				const delta = event.arguments.slice(previousPartialJson.length);
				if (delta.length > 0) {
					stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
				}
			}
		}
	} else return false;
	return true;
}
