import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";

const END_STARTED_PROMPT =
	"A completed work increment is being summarised, and the conversation is returning to its saved marker. Please announce this briefly in your natural voice.";
const END_COMPLETED_PROMPT =
	"The completed work increment has been summarised. The conversation has returned to its marker, and the marker has advanced. Please announce this briefly in your natural voice.";

function announce(pi: ExtensionAPI, id: string, prompt: string): void {
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: true, prompt });
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: false, prompt });
}

export function announceEndStarted(pi: ExtensionAPI): void {
	announce(pi, "pi-auto-trees:end-started", END_STARTED_PROMPT);
}

export function announceEndCompleted(pi: ExtensionAPI): void {
	announce(pi, "pi-auto-trees:end-completed", END_COMPLETED_PROMPT);
}
