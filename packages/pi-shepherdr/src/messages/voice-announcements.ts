import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { PeerMessage } from "../types.js";
import type { AgentEventDetails } from "./event-details.js";

const REALTIME_VOICE_PROMPT_CHANNEL =
	"@howaboua/pi-codex-conversion/realtime-voice-prompt/v1";
const MAX_REALTIME_VOICE_PROMPT_BYTES = 8 * 1_024;

function boundedVoicePrompt(prompt: string): string {
	const bytes = new TextEncoder().encode(prompt);
	if (bytes.byteLength <= MAX_REALTIME_VOICE_PROMPT_BYTES) return prompt;
	return new TextDecoder()
		.decode(bytes.subarray(0, MAX_REALTIME_VOICE_PROMPT_BYTES), {
			stream: true,
		})
		.trimEnd();
}

export function agentVoicePrompt(details: AgentEventDetails): string {
	const lines = [
		`Worker: ${details.machineLabel ?? details.machine} / ${details.name?.trim() || "unnamed"}`,
		`State: ${details.state}`,
	];
	if (details.task?.trim()) lines.push(`Task:\n${details.task.trim()}`);
	let instruction: string;
	if (details.state === "blocked" || details.state === "extension-message") {
		instruction =
			details.state === "extension-message"
				? "Briefly tell the user what this worker reports."
				: "Briefly tell the user why this monitored worker is blocked and what attention may be required.";
		if (details.blockedOn?.trim())
			lines.push(`Reason:\n${details.blockedOn.trim()}`);
		if (details.extensionMessages)
			lines.push(
				...details.extensionMessages.map((message) => message.message),
			);
	} else {
		instruction =
			details.state === "failed"
				? "Briefly tell the user that this monitored worker failed and include useful detail from its report."
				: "Briefly tell the user what this monitored worker found or completed; do not merely announce that it finished.";
		if (details.response?.trim())
			lines.push(`Report:\n${details.response.trim()}`);
	}
	return boundedVoicePrompt(`${instruction}\n\n${lines.join("\n\n")}`);
}

export function announceAgentEvent(
	pi: ExtensionAPI,
	candidateId: string,
	prompt: string,
): void {
	const id =
		new TextEncoder().encode(candidateId).byteLength <= 160
			? candidateId
			: "pi-shepherdr:worker";
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: true, prompt });
	pi.events.emit(REALTIME_VOICE_PROMPT_CHANNEL, { id, active: false, prompt });
}

export function announcePeerMessage(
	pi: ExtensionAPI,
	message: PeerMessage,
): void {
	const source = Object.fromEntries(
		Array.from(
			message.sender.matchAll(/ ([a-z_]+)="([^"]*)"/g),
			([, key, value]) => [key, value],
		),
	);
	if (source["kind"] !== "message" || message.text.startsWith("/")) return;
	announceAgentEvent(
		pi,
		`pi-shepherdr:${source["host"] ?? "local"}:${source["pane"] ?? "peer"}`,
		boundedVoicePrompt(
			`Briefly tell the user the useful update from this peer.\n\nPeer: ${source["host"] ?? "local"} / ${source["name"] || source["pane"] || "unnamed"}\n\nUpdate:\n${message.text.trim()}`,
		),
	);
}
