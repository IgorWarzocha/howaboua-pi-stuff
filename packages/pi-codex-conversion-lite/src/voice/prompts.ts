export const MAX_REALTIME_VOICE_INPUT_BYTES = 32 * 1024;

export function renderRealtimeDelegation(input: string): string {
	return `<realtime_delegation>\n  <input>${escapeXml(input)}</input>\n</realtime_delegation>`;
}

export function renderRealtimeConversationInput(input: string): string {
	return `<realtime_voice_turn>\n  <input>${escapeXml(input)}</input>\n  <routing>handled by realtime voice; no Pi action requested</routing>\n</realtime_voice_turn>`;
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
