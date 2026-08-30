import { open, stat } from "node:fs/promises";
import type {
	LatestAssistant,
	LatestUser,
	PendingAsk,
	SessionView,
} from "./types.js";

const READ_CHUNK_BYTES = 64 * 1024;

function record(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function assistantFromMessage(
	id: string,
	message: Record<string, unknown>,
): LatestAssistant | undefined {
	if (message["role"] !== "assistant") return undefined;
	const text: string[] = [];
	if (typeof message["content"] === "string") {
		text.push(message["content"]);
	} else if (Array.isArray(message["content"])) {
		for (const value of message["content"]) {
			const part = record(value);
			if (part?.["type"] === "text" && typeof part["text"] === "string") {
				text.push(part["text"]);
			}
		}
	}
	const joined = text.join("");
	const stopReason =
		typeof message["stopReason"] === "string"
			? message["stopReason"]
			: undefined;
	if (!joined && stopReason !== "error") return undefined;
	return {
		id,
		text: joined,
		...(stopReason ? { stopReason } : {}),
	};
}

function userFromMessage(
	id: string,
	message: Record<string, unknown>,
): LatestUser | undefined {
	if (message["role"] !== "user") return undefined;
	const text: string[] = [];
	if (typeof message["content"] === "string") {
		text.push(message["content"]);
	} else if (Array.isArray(message["content"])) {
		for (const value of message["content"]) {
			const part = record(value);
			if (part?.["type"] === "text" && typeof part["text"] === "string") {
				text.push(part["text"]);
			}
		}
	}
	const joined = text.join("");
	return joined ? { id, text: joined } : undefined;
}

function askChoice(
	value: unknown,
): PendingAsk["prompts"][number]["choices"][number] | undefined {
	const choice = record(value);
	if (!choice || typeof choice["label"] !== "string") return undefined;
	return {
		label: choice["label"],
		...(typeof choice["description"] === "string"
			? { description: choice["description"] }
			: {}),
	};
}

function askPrompt(value: unknown): PendingAsk["prompts"][number] | undefined {
	const prompt = record(value);
	if (!prompt || typeof prompt["title"] !== "string") return undefined;
	return {
		title: prompt["title"],
		multiple: prompt["multiple"] === true,
		choices: (Array.isArray(prompt["choices"]) ? prompt["choices"] : [])
			.map(askChoice)
			.filter((choice): choice is NonNullable<typeof choice> =>
				Boolean(choice),
			),
		...(typeof prompt["body"] === "string" ? { body: prompt["body"] } : {}),
	};
}

function askCall(value: unknown): PendingAsk | undefined {
	const part = record(value);
	if (
		!part ||
		part["type"] !== "toolCall" ||
		part["name"] !== "ask" ||
		typeof part["id"] !== "string"
	) {
		return undefined;
	}
	const args = record(part["arguments"]);
	if (!args) return undefined;
	const prompts = (Array.isArray(args["prompts"]) ? args["prompts"] : [])
		.map(askPrompt)
		.filter((prompt): prompt is NonNullable<typeof prompt> => Boolean(prompt));
	if (prompts.length === 0) return undefined;
	return {
		toolCallId: part["id"],
		handoff: args["handoff"] === true,
		prompts,
	};
}

function resolvedToolCallId(
	message: Record<string, unknown>,
): string | undefined {
	if (message["role"] !== "toolResult" && message["role"] !== "tool") {
		return undefined;
	}
	const value = message["toolCallId"] ?? message["tool_call_id"];
	return typeof value === "string" ? value : undefined;
}

async function readSessionView(
	path: string,
	size: number,
): Promise<SessionView> {
	const file = await open(path, "r");
	let targetId: string | undefined;
	let assistant: LatestAssistant | undefined;
	let assistantDepth: number | undefined;
	let ask: PendingAsk | undefined;
	let depth = 0;
	let user: LatestUser | undefined;
	let userDepth: number | undefined;
	const resolved = new Set<string>();
	const result = (): SessionView => ({
		...(assistant ? { assistant } : {}),
		...(ask ? { ask } : {}),
		...(user ? { user } : {}),
		...(assistantDepth !== undefined && userDepth !== undefined
			? { assistantAfterUser: assistantDepth < userDepth }
			: {}),
	});
	const inspect = (line: Buffer): boolean => {
		if (line.length === 0) return false;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line.toString("utf8")) as Record<string, unknown>;
		} catch {
			return false;
		}
		const id = entry["id"];
		if (typeof id !== "string") return false;
		targetId ??= id;
		if (id !== targetId) return false;
		const currentDepth = depth;
		depth += 1;
		const message = record(entry["message"]);
		if (message) {
			const resolvedId = resolvedToolCallId(message);
			if (resolvedId) resolved.add(resolvedId);
			if (!assistant) {
				assistant = assistantFromMessage(id, message);
				if (assistant) assistantDepth = currentDepth;
			}
			if (!user) {
				user = userFromMessage(id, message);
				if (user) userDepth = currentDepth;
			}
			if (
				!ask &&
				message["role"] === "assistant" &&
				Array.isArray(message["content"])
			) {
				ask = [...message["content"]]
					.reverse()
					.map(askCall)
					.find(
						(candidate) =>
							candidate !== undefined && !resolved.has(candidate.toolCallId),
					);
			}
		}
		const parentId = entry["parentId"];
		if (typeof parentId !== "string") return true;
		targetId = parentId;
		return false;
	};

	try {
		let position = size;
		let partial = Buffer.alloc(0);
		while (position > 0) {
			const length = Math.min(READ_CHUNK_BYTES, position);
			position -= length;
			const chunk = Buffer.allocUnsafe(length);
			const { bytesRead } = await file.read(chunk, 0, length, position);
			const data = Buffer.concat([chunk.subarray(0, bytesRead), partial]);
			let lineEnd = data.length;
			for (let index = data.length - 1; index >= 0; index -= 1) {
				if (data[index] !== 0x0a) continue;
				if (inspect(data.subarray(index + 1, lineEnd))) {
					return result();
				}
				lineEnd = index;
			}
			partial = data.subarray(0, lineEnd);
		}
		inspect(partial);
		return result();
	} finally {
		await file.close();
	}
}

export class SessionReader {
	private readonly cache = new Map<
		string,
		{ mtimeMs: number; result: SessionView; size: number }
	>();

	async view(path?: string): Promise<SessionView> {
		if (!path) return {};
		let metadata;
		try {
			metadata = await stat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
			throw error;
		}
		const cached = this.cache.get(path);
		if (cached?.size === metadata.size && cached.mtimeMs === metadata.mtimeMs) {
			return cached.result;
		}
		const result = await readSessionView(path, metadata.size);
		this.cache.set(path, {
			mtimeMs: metadata.mtimeMs,
			result,
			size: metadata.size,
		});
		return result;
	}

	async latest(path?: string): Promise<LatestAssistant | undefined> {
		return (await this.view(path)).assistant;
	}
}

export interface AssistantReader {
	latest(path?: string): Promise<LatestAssistant | undefined>;
	view(path?: string): Promise<SessionView>;
}
