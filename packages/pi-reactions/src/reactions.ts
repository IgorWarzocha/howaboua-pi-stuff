import type {
	SessionEntry,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

export const REPLY_ROW = "pi-reactions-reply";
export const REACTION_ENTRY = "pi-reactions-selection";
const REACTION_HEADER = "Reactions to earlier assistant replies:";

export const REACTIONS = {
	like: {
		icon: "👍",
		label: "Looks good",
		instruction: "Looks good. No extra action.",
	},
	dislike: {
		icon: "👎",
		label: "Reconsider",
		instruction:
			"Reconsider this reply. Don't assume which part I objected to.",
	},
	push: {
		icon: "⬆️",
		label: "Push to remote",
		instruction:
			"Push the changes discussed in this reply to their existing remote branch only if the reply and branch are clear. Do not merge or release.",
	},
	verify: {
		icon: "🔍",
		label: "Verify",
		instruction:
			"Check the claim or run the validation discussed in this reply.",
	},
} as const;

export type Reaction = keyof typeof REACTIONS;
export const REACTION_KEYS = Object.keys(REACTIONS) as Reaction[];

export interface ReplyReference {
	replyId: string;
	excerpt: string;
}

export interface ReactionSelection extends ReplyReference {
	reaction: Reaction | null;
}

export function readReplyReference(data: unknown): ReplyReference | undefined {
	if (
		!data ||
		typeof data !== "object" ||
		!("replyId" in data) ||
		typeof data.replyId !== "string" ||
		!("excerpt" in data) ||
		typeof data.excerpt !== "string"
	)
		return undefined;
	return { replyId: data.replyId, excerpt: data.excerpt };
}

function readSelection(data: unknown): ReactionSelection | undefined {
	const reply = readReplyReference(data);
	if (!reply || !data || typeof data !== "object" || !("reaction" in data))
		return undefined;
	const reaction = data.reaction;
	if (reaction === null) return { ...reply, reaction };
	if (typeof reaction !== "string" || !Object.hasOwn(REACTIONS, reaction))
		return undefined;
	return { ...reply, reaction: reaction as Reaction };
}

function isFinishedReply(
	message: SessionMessageEntry["message"],
): message is Extract<SessionMessageEntry["message"], { role: "assistant" }> {
	return (
		message.role === "assistant" &&
		(message.stopReason === "stop" || message.stopReason === "length") &&
		message.content.some(
			(part) => part.type === "text" && /\S/u.test(part.text),
		)
	);
}

export function replyReference(
	entry: SessionMessageEntry,
): ReplyReference | undefined {
	const message = entry.message;
	if (!isFinishedReply(message)) return undefined;
	const excerpt = message.content
		.filter((part) => part.type === "text")
		.map((part) => part.text)
		.join(" ")
		.replace(/\s+/gu, " ")
		.trim();
	return {
		replyId: entry.id,
		excerpt: Array.from(excerpt).slice(0, 72).join(""),
	};
}

type ActiveReaction = ReplyReference & { reaction: Reaction };

function reactionLine(
	selection: ActiveReaction,
	replies: ReadonlyMap<string, number>,
): string {
	const { icon, instruction } = REACTIONS[selection.reaction];
	const position = replies.get(selection.replyId);
	const earlier = position === undefined ? 0 : replies.size - position;
	const reply =
		earlier === 0
			? "Latest finished reply"
			: `Finished reply ${earlier} before the latest`;
	return `- ${reply}, starting ${JSON.stringify(selection.excerpt)}: ${icon} ${instruction}`;
}

export function projectReactions(branch: readonly SessionEntry[]) {
	const selected = new Map<string, Reaction>();
	const pending = new Map<string, ActiveReaction>();
	const replies = new Map<string, number>();
	for (const entry of branch) {
		if (entry.type === "message" && isFinishedReply(entry.message)) {
			replies.set(entry.id, replies.size + 1);
		} else if (entry.type === "custom" && entry.customType === REACTION_ENTRY) {
			const selection = readSelection(entry.data);
			if (!selection || !replies.has(selection.replyId)) continue;
			const { replyId, reaction } = selection;
			if (reaction === null) {
				selected.delete(replyId);
				pending.delete(replyId);
			} else {
				selected.set(replyId, reaction);
				pending.set(replyId, { ...selection, reaction });
			}
		} else if (
			pending.size &&
			entry.type === "message" &&
			entry.message.role === "user"
		) {
			// Consume only annotations present in an accepted user message. A prompt
			// rejected or handled after the input hook must leave clicks pending.
			const content = entry.message.content;
			const text =
				typeof content === "string"
					? content
					: content.find((part) => part.type === "text")?.text;
			if (!text?.startsWith(REACTION_HEADER + "\n")) continue;
			const lines = new Set(text.split("\n\n", 1)[0]?.split("\n"));
			for (const [replyId, selection] of pending) {
				if (lines.has(reactionLine(selection, replies)))
					pending.delete(replyId);
			}
		}
	}
	const prefix = pending.size
		? [
				REACTION_HEADER,
				...Array.from(pending.values(), (selection) =>
					reactionLine(selection, replies),
				),
				"",
				"",
			].join("\n")
		: "";
	return { selected, prefix };
}
