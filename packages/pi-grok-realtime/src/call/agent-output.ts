import type { AssistantMessage } from "@earendil-works/pi-ai";
import { completedVoiceReasoningSummary } from "../reasoning-summary.ts";
import type { GrokSession } from "../session.ts";
/** Owns streaming offsets across Pi assistant messages; output always targets the current socket. */
export class GrokAgentOutput {
	private forwardedText = 0;
	private readonly currentSession: () => GrokSession | undefined;
	constructor(currentSession: () => GrokSession | undefined) {
		this.currentSession = currentSession;
	}
	messageStarted(): void {
		this.forwardedText = 0;
	}
	stream(message: AssistantMessage): void {
		const session = this.currentSession();
		if (!session) return;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		for (;;) {
			const remaining = text.slice(this.forwardedText);
			const match = this.forwardedText
				? /\n\s*\n/.exec(remaining)
				: [...remaining.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)].filter(
						(end) => !/\d/.test(remaining[end.index - 1] ?? ""),
					)[1];
			if (!match || match.index === undefined) return;
			const boundary = match.index + match[0].length;
			if (!/[\p{L}\p{N}]/u.test(remaining.slice(boundary))) return;
			const update = remaining.slice(0, boundary).trim();
			this.forwardedText += boundary;
			if (update)
				session.context(
					`Pi assistant reply continuing; more may follow:\n${update}`,
				);
		}
	}
	message(message: AssistantMessage): void {
		const session = this.currentSession();
		if (!session) return;
		const text = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		const tail = text.slice(this.forwardedText).trim();
		this.forwardedText = 0;
		if (!text.trim() && message.stopReason === "toolUse") {
			const summary = completedVoiceReasoningSummary(message);
			if (summary)
				session.context(
					`Pi progress summary, not a completed result:\n${summary}`,
				);
		}
		if (tail)
			session.context(
				`Pi assistant ${message.stopReason === "toolUse" ? "progress" : "reply"} ending:\n${tail}`,
			);
	}
}
