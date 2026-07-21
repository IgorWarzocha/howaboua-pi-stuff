import type { Message } from "@earendil-works/pi-ai";
import { convertToLlm } from "@earendil-works/pi-coding-agent";

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

function messageLabel(message: Message): string {
	return message.role === "assistant" ? "Assistant" : "User";
}

function messageText(message: Message): string {
	return textFromContent(message.content);
}

function formatMessages(messages: ContextMessages): string {
	const llmMessages = convertToLlm(
		messages.filter((message) =>
			[
				"user",
				"assistant",
				"custom",
				"branchSummary",
				"compactionSummary",
			].includes(message.role),
		),
	);

	return llmMessages
		.filter(
			(message) => message.role === "user" || message.role === "assistant",
		)
		.map((message) => {
			const text = messageText(message);
			return text ? `[${messageLabel(message)}]\n${text}` : "";
		})
		.filter(Boolean)
		.join("\n\n");
}

export interface RescueConversation {
	text: string;
}

export function buildRescueConversation(
	messages: ContextMessages,
	previousSummary: string | undefined,
): RescueConversation {
	const history = formatMessages(messages);
	const previous = previousSummary?.trim()
		? `<previous-summary>\n${previousSummary.trim()}\n</previous-summary>`
		: "";
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
