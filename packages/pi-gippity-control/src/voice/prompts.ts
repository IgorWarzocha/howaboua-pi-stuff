export const MAX_REALTIME_VOICE_INPUT_BYTES = 32 * 1024;

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
