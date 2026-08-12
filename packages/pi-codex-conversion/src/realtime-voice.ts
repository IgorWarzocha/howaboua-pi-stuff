import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
export const MAX_REALTIME_VOICE_PROMPT_BYTES = 4 * 1_024;

export interface RealtimeVoicePromptReport {
	id: string;
	active: boolean;
	prompt: string;
}

export function reportRealtimeVoicePrompt(
	pi: Pick<ExtensionAPI, "events">,
	report: RealtimeVoicePromptReport,
): void {
	const normalized = parseRealtimeVoicePrompt(report);
	if (!normalized) throw new Error("Invalid realtime voice prompt report");
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, normalized);
}

export function parseRealtimeVoicePrompt(
	value: unknown,
): RealtimeVoicePromptReport | undefined {
	if (!value || typeof value !== "object") return undefined;
	const record = value as Record<string, unknown>;
	if (
		typeof record["id"] !== "string" ||
		typeof record["active"] !== "boolean" ||
		typeof record["prompt"] !== "string"
	)
		return undefined;
	const id = record["id"].trim();
	const prompt = record["prompt"];
	if (
		id.length > 160 ||
		!prompt.trim() ||
		new TextEncoder().encode(prompt).byteLength > MAX_REALTIME_VOICE_PROMPT_BYTES
	)
		return undefined;
	return id ? { id, active: record["active"], prompt } : undefined;
}
