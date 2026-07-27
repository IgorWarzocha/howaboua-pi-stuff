import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

export type ReviewRpcFrame =
	| {
			type: "response";
			id: string;
			success: boolean;
			data?: unknown;
			error?: string;
			command?: unknown;
	  }
	| { type: "message_end"; message: Message }
	| { type: "agent_settled" };

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isContentBlocks(value: unknown): boolean {
	return (
		Array.isArray(value) &&
		value.every((part) => isRecord(part) && typeof part["type"] === "string")
	);
}

function isMessage(value: unknown): value is Message {
	if (!isRecord(value)) return false;
	if (value["role"] === "user") {
		return (
			typeof value["content"] === "string" || isContentBlocks(value["content"])
		);
	}
	return (
		(value["role"] === "assistant" || value["role"] === "toolResult") &&
		isContentBlocks(value["content"])
	);
}

function isAssistantMessage(message: Message): message is AssistantMessage {
	return message.role === "assistant";
}

export function parseReviewRpcFrame(line: string): ReviewRpcFrame | undefined {
	if (!line.trim()) return undefined;
	let value: unknown;
	try {
		value = JSON.parse(line) as unknown;
	} catch {
		return undefined;
	}
	if (!isRecord(value)) return undefined;

	if (value["type"] === "response" && typeof value["id"] === "string") {
		return {
			type: "response",
			id: value["id"],
			success: value["success"] !== false,
			...(value["data"] !== undefined ? { data: value["data"] } : {}),
			...(typeof value["error"] === "string" ? { error: value["error"] } : {}),
			...(value["command"] !== undefined ? { command: value["command"] } : {}),
		};
	}
	if (value["type"] === "message_end" && isMessage(value["message"])) {
		return { type: "message_end", message: value["message"] };
	}
	if (value["type"] === "agent_settled") return { type: "agent_settled" };
	return undefined;
}

export function getFinalOutput(messages: Message[]): string {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (!message || !isAssistantMessage(message)) continue;
		for (const part of message.content) {
			if (part.type === "text") return part.text;
		}
	}
	return "";
}
