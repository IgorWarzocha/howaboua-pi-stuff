import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import { renderRealtimeConversationInput, renderRealtimeDelegation } from "./prompts.ts";

export const REALTIME_VOICE_MESSAGE_TYPE = "codex-realtime-voice";

interface RealtimeVoiceMessageDetails {
	input: string;
	route: "conversation" | "delegation";
}

export function realtimeVoiceMessage(input: string, route: RealtimeVoiceMessageDetails["route"]) {
	return {
		customType: REALTIME_VOICE_MESSAGE_TYPE,
		content: route === "delegation" ? renderRealtimeDelegation(input) : renderRealtimeConversationInput(input),
		display: true,
		details: { input, route } satisfies RealtimeVoiceMessageDetails,
	};
}

export function registerCodexVoiceRenderer(pi: ExtensionAPI): void {
	pi.registerMessageRenderer<RealtimeVoiceMessageDetails>(REALTIME_VOICE_MESSAGE_TYPE, (message, _options, theme) => {
		const input = typeof message.details?.input === "string" ? message.details.input : "Voice request";
		const label = theme.bold(theme.fg("customMessageLabel", "Realtime Voice"));
		const body = theme.fg("customMessageText", input);
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(`${label}\n${body}`, 0, 0));
		return box;
	});
}
