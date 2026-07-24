export function renderRealtimeDelegation(input: string): string {
	return `<realtime_delegation>\n  <input>${escapeXml(input)}</input>\n</realtime_delegation>`;
}

export function renderRealtimeConversationInput(input: string): string {
	return `<realtime_voice_turn>\n  <input>${escapeXml(input)}</input>\n  <routing>handled by realtime voice; no Pi action requested</routing>\n</realtime_voice_turn>`;
}

function escapeXml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;");
}
