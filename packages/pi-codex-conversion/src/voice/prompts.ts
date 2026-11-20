export const MAX_REALTIME_VOICE_INPUT_BYTES = 32 * 1024;

export function realtimeGreeting(
	contextual: boolean,
	arrival: boolean,
): string {
	return arrival
		? "The user has just arrived from another session by voice. Give a short, distinctive arrival greeting that makes the switch clear and naturally acknowledges this session's topic or state. Do not repeat the continuity summary or start a task. Then wait for them to speak."
		: contextual
			? "The voice session has started with context from the ongoing conversation. Greet the user by naturally acknowledging the relevant topic, state, or next step. Do not give a generic hello or repeat the context summary. Then wait for them to speak."
			: "The voice session has started. Give the user a short, distinctive greeting with some personality; a bare generic hello is not enough. Then wait for them to speak.";
}

export function realtimeContextTransition(
	reason: "threshold" | "overflow" | "rollover",
): string {
	return reason === "rollover"
		? "I'm moving to a fresh context window and carrying our conversation forward. Briefly acknowledge this in your natural voice."
		: reason === "overflow"
			? "The conversation exceeded its context limit and is being compacted. The interrupted work will continue automatically afterward. Please announce this briefly in your natural voice."
			: "The conversation is being compacted. Please announce this briefly in your natural voice.";
}

// Public Realtime supplies conversation context alongside its task. Codex Live's
// rewritten task is already self-contained and is delivered byte-for-byte.
export function renderRealtimeUserInput(
	input: string,
	transcriptDelta?: string,
): string {
	return transcriptDelta
		? `${input}\n\n<transcript_delta>${escapeXml(transcriptDelta)}</transcript_delta>`
		: input;
}

export function renderRealtimeTranscriptTail(transcriptDelta: string): string {
	return `Remaining voice transcript. Do not respond unless it contains an unhandled request.\n<transcript_delta>${escapeXml(transcriptDelta)}</transcript_delta>`;
}

export function renderPiSteer(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const text = input.trim();
	if (!text || Buffer.byteLength(text) > MAX_REALTIME_VOICE_INPUT_BYTES)
		return undefined;
	return `<active_work_input>\n  <input>${escapeXml(text)}</input>\n  <routing>already delivered; update context, do not delegate again, and wait for the result</routing>\n</active_work_input>`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
