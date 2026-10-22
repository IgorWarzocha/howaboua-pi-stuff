import { randomUUID } from "node:crypto";
import {
	getSupportedThinkingLevels,
	type Message,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInstructions, type SuggestionConfig } from "./config.js";
import { type ConversationSnapshot, conversationUpdate } from "./context.js";
import { cleanupSessionResources } from "./session-resources.js";

const instruction =
	"Draft one concise next request from the user to the assistant. Output only the request.";

interface PredictionSession {
	id: string;
	window: string;
	instructions: string;
	seen: string[];
	messages: Message[];
}

/** Private, append-only model conversation; never written into the user's chat. */
export class Predictions {
	private session: PredictionSession | undefined;

	reset(): void {
		const previous = this.session;
		this.session = undefined;
		if (previous) cleanupSessionResources(previous.id);
	}

	sync(snapshot: ConversationSnapshot): void {
		const current = this.session;
		if (
			current &&
			(current.window !== snapshot.window ||
				current.seen.some((key, index) => snapshot.turns[index]?.key !== key))
		)
			this.reset();
	}

	async predict(
		ctx: ExtensionContext,
		selection: NonNullable<SuggestionConfig["model"]>,
		snapshot: ConversationSnapshot,
		signal: AbortSignal,
	): Promise<{ text: string; commit(): void } | undefined> {
		this.sync(snapshot);
		const instructions = readInstructions().trim();
		if (this.session && this.session.instructions !== instructions)
			this.reset();
		const model = ctx.modelRegistry
			.getAvailable()
			.find(
				(model) =>
					model.provider === selection.provider && model.id === selection.id,
			);
		if (!model)
			throw new Error("The selected suggestion model is unavailable.");
		if (!getSupportedThinkingLevels(model).includes(selection.reasoning))
			throw new Error(
				"The selected suggestion reasoning level is unavailable.",
			);
		const session = (this.session ??= {
			id: randomUUID(),
			window: snapshot.window,
			instructions,
			seen: [],
			messages: [],
		});
		if (session.seen.length === snapshot.turns.length) return undefined;
		const update: Message = {
			role: "user",
			content: conversationUpdate(snapshot, session.seen.length),
			timestamp: Date.now(),
		};
		const reply = await ctx.modelRegistry
			.streamSimple(
				model,
				{
					systemPrompt: [instruction, instructions]
						.filter(Boolean)
						.join("\n\n"),
					messages: [...session.messages, update],
				},
				{
					signal,
					...(selection.reasoning === "off"
						? {}
						: { reasoning: selection.reasoning }),
					maxTokens: 1024,
					cacheRetention: "short",
					sessionId: session.id,
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
		const final = reply.content.findLast(
			(part) => part.type === "text" && part.text.trim(),
		);
		const text =
			final?.type === "text" ? final.text.trim().replace(/\s+/gu, " ") : "";
		if (!text || /\p{Cc}/u.test(text)) return undefined;
		return {
			text,
			commit: () => {
				if (this.session !== session || signal.aborted) return;
				// Preserve provider reply metadata and thinking for exact continuation.
				session.messages.push(update, reply);
				session.seen = snapshot.turns.map((turn) => turn.key);
			},
		};
	}
}
