import type { Message } from "@earendil-works/pi-ai";
import { convertToLlm, estimateTokens } from "@earendil-works/pi-coding-agent";

type ContextMessages = Parameters<typeof convertToLlm>[0];

function textFromContent(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";

	return content
		.flatMap((part) => {
			if (!part || typeof part !== "object") return [];
			const block = part as {
				type?: unknown;
				text?: unknown;
				thinking?: unknown;
			};
			if (block.type === "text" && typeof block.text === "string")
				return [block.text];
			if (block.type === "thinking" && typeof block.thinking === "string") {
				return [`[thinking]\n${block.thinking}`];
			}
			return [];
		})
		.join("\n")
		.trim();
}

function messageLabel(message: ContextMessages[number]): string {
	switch (message.role) {
		case "assistant":
			return "Assistant";
		case "custom":
			return `Extension (${message.customType})`;
		case "branchSummary":
			return "Branch summary";
		case "compactionSummary":
			return "Previous compaction summary";
		default:
			return "User";
	}
}

function messageText(message: Message): string {
	return textFromContent(message.content);
}

interface RescueMessage {
	text: string;
	tokens: number;
}

function formatMessages(messages: ContextMessages): RescueMessage[] {
	const sourceMessages = messages.filter((message) =>
		[
			"user",
			"assistant",
			"custom",
			"branchSummary",
			"compactionSummary",
		].includes(message.role),
	);
	const llmMessages = convertToLlm(sourceMessages);

	return llmMessages.flatMap((message, index) => {
		if (message.role !== "user" && message.role !== "assistant") return [];
		const sourceMessage = sourceMessages[index];
		if (!sourceMessage) return [];
		const text = messageText(message);
		if (!text) return [];
		return [
			{
				text: `[${messageLabel(sourceMessage)}]\n${text}`,
				tokens: estimateTokens(sourceMessage),
			},
		];
	});
}

export function truncateRescueText(
	text: string,
	maxTokens: number,
	marker = "[Earlier context omitted]\n",
): string {
	const maxChars = Math.max(1, maxTokens * 4);
	if (text.length <= maxChars) return text;
	if (maxChars <= marker.length) return marker.slice(0, maxChars);
	const contentChars = maxChars - marker.length;
	const beginningChars = Math.ceil(contentChars / 2);
	const endingChars = contentChars - beginningChars;
	return (
		text.slice(0, beginningChars) +
		marker +
		(endingChars > 0 ? text.slice(-endingChars) : "")
	);
}

function selectRecentMessages(
	messages: RescueMessage[],
	maxTokens: number,
): string {
	if (!Number.isFinite(maxTokens))
		return messages.map((message) => message.text).join("\n\n");

	let remaining = Math.max(1, maxTokens);
	const selected: RescueMessage[] = [];
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message) continue;
		if (message.tokens <= remaining) {
			selected.unshift(message);
			remaining -= message.tokens;
			continue;
		}
		if (selected.length === 0 && remaining > 8) {
			selected.unshift({
				text: truncateRescueText(message.text, remaining),
				tokens: remaining,
			});
		}
		break;
	}

	const omitted = selected.length < messages.length;
	return [
		omitted ? "[Earlier conversation omitted]" : "",
		...selected.map((message) => message.text),
	]
		.filter(Boolean)
		.join("\n\n");
}

export interface RescueConversation {
	text: string;
}

export function buildRescueConversation(
	messages: ContextMessages,
	previousSummary: string | undefined,
	maxTokens = Number.POSITIVE_INFINITY,
): RescueConversation {
	const formattedMessages = formatMessages(messages);
	const previousText = previousSummary?.trim();
	const previousBudget = Number.isFinite(maxTokens)
		? Math.max(1, Math.floor(maxTokens * 0.25))
		: Number.POSITIVE_INFINITY;
	const previous = previousText
		? `<previous-summary>\n${truncateRescueText(previousText, previousBudget)}\n</previous-summary>`
		: "";
	const previousTokens = previous ? Math.ceil(previous.length / 4) : 0;
	const history = selectRecentMessages(
		formattedMessages,
		Number.isFinite(maxTokens)
			? Math.max(1, maxTokens - previousTokens)
			: Number.POSITIVE_INFINITY,
	);
	const source = [
		previous,
		history ? `<conversation>\n${history}\n</conversation>` : "",
	]
		.filter(Boolean)
		.join("\n\n");
	return {
		text: source,
	};
}

export const RESCUE_SYSTEM_PROMPT =
	"You are a context-rescue summarizer. Do not continue the conversation or answer its questions. Produce only a concise structured summary that lets another agent resume the work. Preserve the user's intent, exact paths and names, unresolved work, decisions, and the collaborative tone. Tool calls and tool results were intentionally omitted; never invent facts that are not present.";

export function buildRescuePrompt(
	conversation: RescueConversation,
	instructions?: string,
): string {
	return [
		conversation.text,
		"",
		"Summarize this session as a context checkpoint.",
		"Use these headings: Goal, Constraints & Preferences, Progress, Key Decisions, Next Steps, Critical Context.",
		"Keep it compact but preserve the session's general vibe and the user's unfinished thread.",
		"Do not mention omitted tools unless the conversation itself mentions their consequences.",
		instructions?.trim() ? `Additional focus: ${instructions.trim()}` : "",
	]
		.filter(Boolean)
		.join("\n\n");
}
