import type { FocusRequest } from "../types.js";

function focusOrigin({ source }: FocusRequest) {
	return { host: source.host, session: source.session, pane: source.pane };
}

export function focusArrivalContent(
	request: FocusRequest,
	machine: string,
	codeMode: boolean,
) {
	const returnFocus = {
		action: "focus",
		target: request.source.pane,
		machine,
		voice: request.voice === true,
	};
	const args = JSON.stringify(returnFocus);
	const callable = codeMode ? `await tools.agents(${args})` : `agents ${args}`;
	return {
		returnFocus,
		content: `User arrived from ${JSON.stringify({ ...focusOrigin(request), machine })}\nReturn: ${callable}${request.voice ? "\nVoice transfer pending" : ""}${request.handoff ? `\nHandoff from that session:\n${request.handoff}` : ""}`,
	};
}

export function voiceFocusContinuity(request: FocusRequest): string {
	return `User transferring voice from ${JSON.stringify(focusOrigin(request))}${request.handoff ? `\nHandoff from that session:\n${request.handoff}` : ""}`;
}

export function voiceFocusReport(
	side: "source" | "destination",
	target: string,
	error?: unknown,
): string {
	return error === undefined
		? `Voice transfer complete (${side}, ${target}); replacement call active`
		: `Voice transfer failed (${side}, ${target}): ${error instanceof Error ? error.message : String(error)}. Voice availability is not confirmed; inspect the session before retrying`;
}
