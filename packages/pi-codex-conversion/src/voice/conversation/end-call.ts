export const END_CALL_TOOL = {
	type: "function",
	name: "end_call",
	description:
		"End the voice call after playback. Call only after the requested answer has been spoken; do not wait for unrelated work",
	parameters: { type: "object", properties: {}, additionalProperties: false },
};

export interface PreparedVoiceTask {
	input: string;
	endCall: boolean;
}
