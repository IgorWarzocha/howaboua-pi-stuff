import { getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { SuggestionConfig } from "./config.js";

const instruction = `Always suggest a useful next step as a concise user-to-assistant request. Use placeholders for missing details. Output only the request.`;

export function predictionContext(ctx: ExtensionContext): string | undefined {
	const messages = ctx.sessionManager.buildSessionProjection().messages;
	const latest = messages.findLast((message) => message.role === "assistant");
	if (
		!latest ||
		latest.role !== "assistant" ||
		latest.stopReason !== "stop" ||
		!latest.content.some((part) => part.type === "text" && part.text.trim())
	)
		return undefined;
	const turns: { role: string; text: string }[] = [];
	let remaining = 16000;
	let hasUser = false;
	for (
		let i = messages.length - 1;
		i >= 0 && turns.length < 10 && remaining > 0;
		i--
	) {
		const message = messages[i];
		if (!message || (message.role !== "user" && message.role !== "assistant"))
			continue;
		if (message.role === "assistant" && message.stopReason !== "stop") continue;
		const content = message.content;
		const text =
			typeof content === "string"
				? content
				: content
						.filter((part) => part.type === "text")
						.map((part) => part.text)
						.join("\n");
		if (!text.trim()) continue;
		if (message.role === "user") hasUser = true;
		const limit = Math.min(remaining, 3000);
		// User intent starts at the head; the assistant's conclusion is at the tail.
		const bounded =
			text.length <= limit
				? text
				: message.role === "user"
					? `${text.slice(0, limit)} [truncated]`
					: `[truncated] ${text.slice(-limit)}`;
		turns.unshift({ role: message.role, text: bounded });
		remaining -= bounded.length;
	}
	if (!hasUser) return undefined;
	const summary = messages.findLast(
		(message) => message.role === "compactionSummary",
	);
	return JSON.stringify({
		...(summary?.role === "compactionSummary"
			? { earlierSummary: summary.summary.slice(0, 3000) }
			: {}),
		turns,
	});
}

export async function predict(
	ctx: ExtensionContext,
	selection: NonNullable<SuggestionConfig["model"]>,
	context: string,
	signal: AbortSignal,
): Promise<string | undefined> {
	const model = ctx.modelRegistry
		.getAvailable()
		.find(
			(model) =>
				model.provider === selection.provider && model.id === selection.id,
		);
	if (!model) throw new Error("The selected suggestion model is unavailable.");
	if (!getSupportedThinkingLevels(model).includes(selection.reasoning))
		throw new Error("The selected suggestion reasoning level is unavailable.");
	// No sessionId: this is a transient auxiliary request, not a main-chat
	// continuation or a retained provider connection requiring private cleanup.
	const reply = await ctx.modelRegistry
		.streamSimple(
			model,
			{
				systemPrompt: instruction,
				messages: [
					{
						role: "user",
						content: `Conversation:\n${context}\n\nDraft the next request from the user to the assistant:`,
						timestamp: Date.now(),
					},
				],
			},
			{
				signal,
				...(selection.reasoning === "off"
					? {}
					: { reasoning: selection.reasoning }),
				maxTokens: 1024,
				cacheRetention: "none",
			},
		)
		.result();
	if (signal.aborted) return undefined;
	if (reply.stopReason === "error" || reply.stopReason === "aborted")
		throw new Error("The suggestion request did not complete.");
	if (
		reply.stopReason !== "stop" ||
		reply.content.some((part) => part.type === "toolCall")
	)
		return undefined;
	// Providers can include an earlier draft or commentary before the final text.
	const final = reply.content.findLast(
		(part) => part.type === "text" && part.text.trim(),
	);
	const text =
		final?.type === "text" ? final.text.trim().replace(/\s+/gu, " ") : "";
	if (!text || /\p{Cc}/u.test(text)) return undefined;
	return text;
}
