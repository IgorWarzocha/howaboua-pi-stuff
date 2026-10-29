export const END_CALL_TOOL = {
	type: "function",
	name: "end_call",
	description: "End the voice call after your farewell finishes playing",
	parameters: { type: "object", properties: {}, additionalProperties: false },
};

export interface PreparedVoiceTask {
	input: string;
	endCall: boolean;
}
