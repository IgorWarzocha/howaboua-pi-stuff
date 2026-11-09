import { randomUUID } from "node:crypto";
import {
	type Api,
	getSupportedThinkingLevels,
	type Message,
	type Model,
	type ModelThinkingLevel,
} from "@earendil-works/pi-ai";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readInstructions, type SuggestionConfig } from "./config.js";
import { type ConversationSnapshot, conversationUpdate } from "./context.js";
import { cleanupSessionResources } from "./session-resources.js";

const instruction =
	"Draft one concise next request from the user to the assistant. Output only the request.";

interface PredictionSession {
	id: string;
	provider: string;
	model: string;
	window: string;
	instructions: string;
	seen: string[];
	messages: Message[];
}

class RequestFailed extends Error {
	constructor() {
		super("The suggestion model request failed.");
	}
}

/** Private, append-only model conversation; never written into the user's chat. */
export class Predictions {
	private session: PredictionSession | undefined;
	private generation = 0;

	reset(): void {
		this.generation++;
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
		useChatModelAsFallback = false,
		onFallback: (model: Model<Api> | undefined) => void = () => {},
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
		if (model) {
			if (!getSupportedThinkingLevels(model).includes(selection.reasoning))
				throw new Error(
					"The selected suggestion reasoning level is unavailable.",
				);
			try {
				const result = await this.request(
					ctx,
					model,
					selection.reasoning,
					snapshot,
					instructions,
					signal,
				);
				if (result && !signal.aborted) onFallback(undefined);
				return result;
			} catch (error) {
				if (
					!(error instanceof RequestFailed) ||
					!useChatModelAsFallback ||
					signal.aborted
				)
					throw error;
			}
		} else if (!useChatModelAsFallback) {
			throw new Error("The selected suggestion model is unavailable.");
		}
		if (signal.aborted) return undefined;
		const chat = ctx.model;
		if (!chat)
			throw new Error(
				"No current chat model is selected for suggestion fallback. Choose a chat model or change /suggestions.",
			);
		if (chat.provider === selection.provider && chat.id === selection.id)
			throw new Error(
				"The suggestion model is already the current chat model; no fallback retry was made.",
			);
		const fallback = ctx.modelRegistry
			.getAvailable()
			.find(
				(entry) => entry.provider === chat.provider && entry.id === chat.id,
			);
		if (!fallback)
			throw new Error(
				"The current chat model is unavailable for suggestion fallback. Check provider access or change /suggestions.",
			);
		const levels = getSupportedThinkingLevels(fallback);
		const reasoning = levels.includes(selection.reasoning)
			? selection.reasoning
			: "off";
		if (!levels.includes(reasoning))
			throw new Error(
				"The current chat model cannot use the selected reasoning or run without reasoning. Change /suggestions.",
			);
		onFallback(fallback);
		return this.request(
			ctx,
			fallback,
			reasoning,
			snapshot,
			instructions,
			signal,
		);
	}

	private async request(
		ctx: ExtensionContext,
		model: Model<Api>,
		reasoning: ModelThinkingLevel,
		snapshot: ConversationSnapshot,
		instructions: string,
		signal: AbortSignal,
	): Promise<{ text: string; commit(): void } | undefined> {
		if (signal.aborted) return undefined;
		const previous = this.session;
		const generation = this.generation;
		// A failed primary attempt must not retire a working fallback conversation.
		const session =
			previous?.provider === model.provider && previous.model === model.id
				? previous
				: {
						id: randomUUID(),
						provider: model.provider,
						model: model.id,
						window: snapshot.window,
						instructions,
						seen: [],
						messages: [],
					};
		try {
			if (session.seen.length === snapshot.turns.length) return undefined;
			const update: Message = {
				role: "user",
				content: conversationUpdate(snapshot, session.seen.length),
				timestamp: Date.now(),
			};
			const reply = await (async () => {
				try {
					return await ctx.modelRegistry
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
								...(reasoning === "off" ? {} : { reasoning }),
								maxTokens: 1024,
								cacheRetention: "short",
								sessionId: session.id,
							},
						)
						.result();
				} catch (error) {
					if (error instanceof Error && error.name === "AbortError")
						throw new Error("The suggestion request was cancelled.");
					throw new RequestFailed();
				}
			})();
			if (signal.aborted) return undefined;
			if (reply.stopReason === "error") throw new RequestFailed();
			if (reply.stopReason === "aborted")
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
			if (this.generation !== generation || this.session !== previous)
				return undefined;
			if (session !== previous) {
				this.reset();
				this.session = session;
			}
			return {
				text,
				commit: () => {
					if (this.session !== session || signal.aborted) return;
					// Preserve provider reply metadata and thinking for exact continuation.
					session.messages.push(update, reply);
					session.seen = snapshot.turns.map((turn) => turn.key);
				},
			};
		} finally {
			if (this.session !== session) cleanupSessionResources(session.id);
		}
	}
}
