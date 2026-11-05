import type { ResponseStreamEvent } from "openai/resources/responses/responses.js";
import { appendGrammarToolInputJsonDelta, closeGrammarToolInputJson } from "../../constrained-sampling.js";
import type { CustomToolCallState, ResponsesStreamOutput } from "./output-items.ts";

export function closeCustomInput(
	state: CustomToolCallState,
	finalInput: string | undefined,
): string | undefined {
	return sendCustomInput(state, closeGrammarToolInputJson(state.jsonBuffer, state.property, finalInput));
}

function sendCustomInput(state: CustomToolCallState, delta: string | undefined): string | undefined {
	state.block.arguments = { [state.property]: state.jsonBuffer.input };
	if (state.unsent === "") return delta;
	const sent = state.unsent + (delta ?? "");
	state.unsent = "";
	return sent;
}

export function applyResponsesToolDelta(event: ResponseStreamEvent, state: ResponsesStreamOutput): boolean {
	const { output, stream, outputStates } = state;
	if (event.type === "response.custom_tool_call_input.delta") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "custom_tool_call") {
			const delta = sendCustomInput(state, appendGrammarToolInputJsonDelta(state.jsonBuffer, state.property, event.delta));
			if (delta !== undefined) stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
		}
		return true;
	}
	if (event.type === "response.custom_tool_call_input.done") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "custom_tool_call") {
			const delta = closeCustomInput(state, event.input);
			if (delta !== undefined) stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta, partial: output });
		}
		return true;
	}
	if (event.type === "response.function_call_arguments.delta") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "function_call") {
			state.block.arguments = state.arguments.append(event.delta);
			stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta: event.delta, partial: output });
		}
	} else if (event.type === "response.function_call_arguments.done") {
		const state = outputStates.get(event.output_index);
		if (state?.kind === "function_call") {
			const replaced = state.arguments.replace(event.arguments);
			state.block.arguments = replaced.arguments;
			if (replaced.delta) stream.push({ type: "toolcall_delta", contentIndex: state.blockIndex, delta: replaced.delta, partial: output });
		}
	} else return false;
	return true;
}
