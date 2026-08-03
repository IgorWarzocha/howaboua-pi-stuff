export const MAX_REALTIME_VOICE_INPUT_BYTES = 32 * 1024;

export function renderRealtimeDelegation(input: string, transcriptDelta?: string): string {
	const transcript = transcriptDelta ? `\n  <transcript_delta>${escapeXml(transcriptDelta)}</transcript_delta>` : "";
	return `<realtime_delegation>\n  <input>${escapeXml(input)}</input>${transcript}\n</realtime_delegation>`;
}

export function renderRealtimeConversationInput(input: string): string {
	return `<realtime_voice_turn>\n  <input>${escapeXml(input)}</input>\n  <routing>handled by realtime voice; no Pi action requested</routing>\n</realtime_voice_turn>`;
}

export function renderRealtimeTranscriptTail(transcriptDelta: string): string {
	return `<realtime_delegation>\n  <source>transcript_tail_flush</source>\n  <input>The user just ended their realtime session. Here is the remaining transcript tail. Do not respond unless it contains an unhandled request.</input>\n  <transcript_delta>${escapeXml(transcriptDelta)}</transcript_delta>\n</realtime_delegation>`;
}

export function renderPiSteer(input: unknown): string | undefined {
	if (typeof input !== "string") return undefined;
	const text = input.trim();
	if (!text || Buffer.byteLength(text) > MAX_REALTIME_VOICE_INPUT_BYTES) return undefined;
	return `<pi_steer>\n  <input>${escapeXml(text)}</input>\n  <routing>already delivered to the active Pi run; update context, do not delegate it, and wait for authoritative Pi updates</routing>\n</pi_steer>`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
