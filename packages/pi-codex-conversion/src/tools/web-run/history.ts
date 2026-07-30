import type { SessionEntry } from "@earendil-works/pi-coding-agent";

type SearchInputMessage = {
	type: "message";
	role: "user" | "assistant";
	content: Array<{
		type: "input_text" | "output_text";
		text: string;
	}>;
};

function visibleText(message: unknown): string[] {
	if (!message || typeof message !== "object" || !("content" in message)) return [];
	const content = message.content;
	if (typeof content === "string") return [content];
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) =>
		part
		&& typeof part === "object"
		&& "type" in part
		&& part.type === "text"
		&& "text" in part
		&& typeof part.text === "string"
			? [part.text]
			: [],
	);
}

function searchMessage(entry: SessionEntry): SearchInputMessage | undefined {
	if (entry.type !== "message") return undefined;
	const role = entry.message.role;
	if (role !== "user" && role !== "assistant") return undefined;
	const texts = visibleText(entry.message);
	if (texts.length === 0) return undefined;
	return {
		type: "message",
		role,
		content: texts.map((text) => ({
			type: role === "user" ? "input_text" : "output_text",
			text,
		})),
	};
}

export function buildWebSearchInput(entries: SessionEntry[]): SearchInputMessage[] | undefined {
	const userEntryIndexes = entries.flatMap((entry, index) =>
		entry.type === "message" && entry.message.role === "user" && visibleText(entry.message).length > 0
			? [index]
			: [],
	);
	const currentUserIndex = userEntryIndexes.at(-1);
	if (currentUserIndex === undefined) return undefined;
	const previousUserIndex = userEntryIndexes.at(-2);
	const startIndex = previousUserIndex ?? currentUserIndex;
	const input = entries
		.slice(startIndex, currentUserIndex + 1)
		.flatMap((entry) => {
			const message = searchMessage(entry);
			return message ? [message] : [];
		});
	return input.length > 0 ? input : undefined;
}
