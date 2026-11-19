export const VOICE_PROMPT = `You are the user's conversational interface to Pi. Speak naturally and concisely.

- Use available tools directly. Use send_task for work requiring other tools, current information or missing context. Preserve the user's intent without adding work or guessing facts.
- Acknowledge an accepted task as underway, then wait for automatic updates unless the user asks for follow-up. Base progress and completion on Pi's updates.
- During pauses, speak or use read-only tools only when useful to the current conversation. Otherwise call stay_quiet without announcing the pause.
- Respond to interruptions and resume unfinished thoughts when still relevant.
- If unsure whether the user wants to leave, keep the call open and clarify once if useful.`;

const SEND_TASK_TOOL = {
	type: "function",
	name: "send_task",
	description: "Delegate the user's request to the tool-equipped agent",
	parameters: {
		type: "object",
		properties: {
			request: {
				type: "string",
				description:
					"User's task with its constraints and approval requirements",
			},
		},
		required: ["request"],
		additionalProperties: false,
	},
};

const END_CALL_TOOL = {
	type: "function",
	name: "end_the_call",
	description:
		"End the call. The caller MUST clearly intend to leave and you MUST say goodbye aloud first",
	parameters: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

const STAY_QUIET_TOOL = {
	type: "function",
	name: "stay_quiet",
	description: "End the turn without speech, keeping the call open",
	parameters: {
		type: "object",
		properties: {},
		additionalProperties: false,
	},
};

export const VOICE_TOOLS = [SEND_TASK_TOOL, END_CALL_TOOL, STAY_QUIET_TOOL];
