import type {
	SessionEntry,
	SessionMessageEntry,
} from "@earendil-works/pi-coding-agent";

export const REPLY_ROW = "pi-reactions-reply";
export const REACTION_ENTRY = "pi-reactions-reaction";
const REACTION_MESSAGE = "pi-reactions-delivery";

export const REACTIONS = {
	like: { icon: "👍", label: "OK" },
	dislike: { icon: "👎", label: "Reconsider" },
	push: { icon: "⬆️", label: "Push" },
	verify: { icon: "🔍", label: "Verify" },
} as const;

export type Reaction = keyof typeof REACTIONS;
export const REACTION_KEYS = Object.keys(REACTIONS) as Reaction[];

export function readReplyId(data: unknown): string | undefined {
	return data &&
		typeof data === "object" &&
		"replyId" in data &&
		typeof data.replyId === "string"
		? data.replyId
		: undefined;
}

function readReaction(data: unknown): Reaction | null | undefined {
	if (!data || typeof data !== "object" || !("reaction" in data))
		return undefined;
	const reaction = data.reaction;
	if (reaction === null) return null;
	return typeof reaction === "string" && Object.hasOwn(REACTIONS, reaction)
		? (reaction as Reaction)
		: undefined;
}

export function isFinishedReply(
	message: SessionMessageEntry["message"],
): boolean {
	return (
		message.role === "assistant" &&
		(message.stopReason === "stop" || message.stopReason === "length") &&
		message.content.some(
			(part) => part.type === "text" && /\S/u.test(part.text),
		)
	);
}

function deliveredSelections(details: unknown): Set<unknown> {
	return new Set(
		details &&
			typeof details === "object" &&
			"selectionIds" in details &&
			Array.isArray(details.selectionIds)
			? details.selectionIds
			: [],
	);
}

export function projectReactions(branch: readonly SessionEntry[]) {
	const selected = new Map<string, Reaction>();
	const pending = new Map<
		string,
		{ reaction: Reaction; selectionId: string }
	>();
	const replies = new Map<string, number>();
	for (const entry of branch) {
		if (entry.type === "message" && isFinishedReply(entry.message)) {
			replies.set(entry.id, replies.size);
		} else if (entry.type === "custom" && entry.customType === REACTION_ENTRY) {
			const replyId = readReplyId(entry.data);
			const reaction = readReaction(entry.data);
			if (
				replyId === undefined ||
				!replies.has(replyId) ||
				reaction === undefined
			)
				continue;
			if (reaction === null) {
				selected.delete(replyId);
				pending.delete(replyId);
			} else {
				selected.set(replyId, reaction);
				pending.set(replyId, { reaction, selectionId: entry.id });
			}
		} else if (
			pending.size &&
			entry.type === "custom_message" &&
			entry.customType === REACTION_MESSAGE
		) {
			const delivered = deliveredSelections(entry.details);
			for (const [replyId, selection] of pending) {
				if (delivered.has(selection.selectionId)) pending.delete(replyId);
			}
		}
	}
	const lines: string[] = [];
	const selectionIds: string[] = [];
	for (const [replyId, { reaction, selectionId }] of pending) {
		const position = replies.get(replyId);
		if (position === undefined) continue;
		const earlier = replies.size - position - 1;
		const target =
			earlier === 0
				? "your latest reply"
				: earlier === 1
					? "the reply before your latest"
					: `the reply ${earlier} before your latest`;
		const { icon, label } = REACTIONS[reaction];
		lines.push(`User reaction to ${target}: ${icon} ${label}`);
		selectionIds.push(selectionId);
	}
	return {
		selected,
		message: lines.length
			? {
					customType: REACTION_MESSAGE,
					display: false,
					content: lines.join("\n"),
					details: { selectionIds },
				}
			: undefined,
	};
}
