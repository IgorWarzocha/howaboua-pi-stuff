import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "./message-types.ts";

type ContextMessage = {
	role: string;
	customType?: string | undefined;
	content?: unknown;
};

export function isVoiceContextExcludedMessage(message: ContextMessage): boolean {
	if (message.role !== "custom") return false;
	if (message.customType === REALTIME_VOICE_MESSAGE_TYPE) return true;
	return (
		message.customType === CODEX_VOICE_MODE_MESSAGE_TYPE &&
		(typeof message.content !== "string" ||
			!message.content.startsWith('<realtime_voice_session state="'))
	);
}
