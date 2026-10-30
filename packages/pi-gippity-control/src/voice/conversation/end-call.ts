import { Type } from "typebox";

export const END_CALL_TOOL = {
	type: "function",
	name: "end_call",
	description:
		"End the voice call after playback. Call only after the requested answer has been spoken; do not wait for unrelated work",
	parameters: Type.Object({}, { additionalProperties: false }),
};

export const END_CALL_TASK_TOOL = {
	name: END_CALL_TOOL.name,
	description: "End the voice call; preserve any remaining requested work",
	parameters: Type.Object(
		{
			request: Type.String({
				description: "Remaining task for Pi, or empty if none",
			}),
		},
		{ additionalProperties: false },
	),
};

export interface PreparedVoiceTask {
	input: string;
	endCall: boolean;
}
