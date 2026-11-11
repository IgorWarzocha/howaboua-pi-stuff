import { obj, str } from "@earendil-works/pi-schema";

export const END_CALL_TOOL = {
	type: "function",
	name: "end_call",
	description:
		"End the voice call after playback. Call only after the requested answer has been spoken; do not wait for unrelated work",
	parameters: obj({}, { open: false }),
};

export const END_CALL_TASK_TOOL = {
	name: END_CALL_TOOL.name,
	description: "End the voice call; preserve any remaining requested work",
	parameters: obj(
		{
			request: str({
				description: "Remaining task for Pi, or empty if none",
			}),
		},
		{ open: false },
	),
};

export interface PreparedVoiceTask {
	input: string;
	endCall: boolean;
}
