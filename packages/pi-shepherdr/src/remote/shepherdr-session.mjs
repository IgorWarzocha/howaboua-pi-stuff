// @howaboua/pi-shepherdr managed bridge
import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const READ_CHUNK_BYTES = 64 * 1024;
const sessionCache = new Map();

function expandHome(path) {
	return path === "~"
		? homedir()
		: path.startsWith("~/")
			? join(homedir(), path.slice(2))
			: path;
}

function assistantFromMessage(id, message) {
	if (message.role !== "assistant") return undefined;
	const text = [];
	if (typeof message.content === "string") text.push(message.content);
	else if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (
				part &&
				typeof part === "object" &&
				part.type === "text" &&
				typeof part.text === "string"
			)
				text.push(part.text);
		}
	}
	const joined = text.join("");
	const stopReason =
		typeof message.stopReason === "string" ? message.stopReason : undefined;
	if (!joined && stopReason !== "error") return undefined;
	return {
		id,
		text: joined,
		...(stopReason ? { stopReason } : {}),
	};
}

function inputFromMessage(id, message) {
	if (message.role !== "user") return undefined;
	const text = [];
	if (typeof message.content === "string") text.push(message.content);
	else if (Array.isArray(message.content)) {
		for (const part of message.content) {
			if (
				part &&
				typeof part === "object" &&
				part.type === "text" &&
				typeof part.text === "string"
			)
				text.push(part.text);
		}
	}
	const joined = text.join("");
	return joined ? { id, text: joined } : undefined;
}

function askChoice(value) {
	if (!value || typeof value !== "object" || typeof value.label !== "string")
		return undefined;
	return {
		label: value.label,
		...(typeof value.description === "string"
			? { description: value.description }
			: {}),
	};
}

function askPrompt(value) {
	if (!value || typeof value !== "object" || typeof value.title !== "string")
		return undefined;
	return {
		title: value.title,
		multiple: value.multiple === true,
		choices: (Array.isArray(value.choices) ? value.choices : [])
			.map(askChoice)
			.filter(Boolean),
		...(typeof value.body === "string" ? { body: value.body } : {}),
	};
}

function askCall(value) {
	if (
		!value ||
		typeof value !== "object" ||
		value.type !== "toolCall" ||
		value.name !== "ask" ||
		typeof value.id !== "string"
	)
		return undefined;
	return askFromInput(value.id, value.arguments);
}

function askFromInput(toolCallId, input) {
	if (!input || typeof input !== "object" || Array.isArray(input))
		return undefined;
	const prompts = (Array.isArray(input.prompts) ? input.prompts : [])
		.map(askPrompt)
		.filter(Boolean);
	if (prompts.length === 0) return undefined;
	return {
		toolCallId,
		handoff: input.handoff === true,
		prompts,
	};
}

function askResult(message) {
	if (message.role !== "toolResult" || message.toolName !== "ask")
		return undefined;
	const id = message.toolCallId ?? message.tool_call_id;
	if (typeof id !== "string") return undefined;
	if (message.isError === true) return [id, { status: "rejected" }];
	if (message.isError !== false) return [id, { status: "unknown" }];
	if (message.details?.dismissed === true) return [id, { status: "rejected" }];
	const rawResponses = message.details?.responses;
	const rawResponseCount = Array.isArray(rawResponses)
		? rawResponses.length
		: -1;
	const responses = Array.isArray(rawResponses)
		? rawResponses
				.map((response) => {
					if (
						!response ||
						typeof response !== "object" ||
						typeof response.id !== "string" ||
						!Array.isArray(response.selections) ||
						!response.selections.every(
							(selection) => typeof selection === "string",
						)
					)
						return undefined;
					return {
						id: response.id,
						selections: response.selections,
						...(typeof response.comment === "string"
							? { comment: response.comment }
							: {}),
					};
				})
				.filter(Boolean)
		: undefined;
	return [
		id,
		{
			status: "accepted",
			...(responses && responses.length === rawResponseCount
				? { responses }
				: {}),
		},
	];
}

async function sessionView(path, size) {
	const file = await open(path, "r");
	let targetId;
	let assistant;
	let assistantDepth;
	let ask;
	const askResults = new Map();
	let depth = 0;
	let input;
	let inputDepth;
	const resolved = new Set();
	const result = () => ({
		...(assistant ? { assistant } : {}),
		...(ask ? { ask } : {}),
		...(askResults.size > 0
			? { askResults: Object.fromEntries(askResults) }
			: {}),
		...(input ? { input } : {}),
		...(assistantDepth !== undefined && inputDepth !== undefined
			? { assistantAfterInput: assistantDepth < inputDepth }
			: {}),
	});
	const inspect = (line) => {
		if (line.length === 0) return false;
		let entry;
		try {
			entry = JSON.parse(line.toString("utf8"));
		} catch {
			return false;
		}
		if (typeof entry.id !== "string") return false;
		targetId ??= entry.id;
		if (entry.id !== targetId) return false;
		const currentDepth = depth;
		depth += 1;
		if (entry.type === "custom" && entry.customType === "pi-ask-active") {
			const update = entry.data;
			if (update?.version === 1 && typeof update.id === "string") {
				if (update.state === "closed") resolved.add(update.id);
				else if (
					update.state === "active" &&
					!ask &&
					!resolved.has(update.id)
				) {
					ask = askFromInput(update.id, update);
				}
			}
		}
		if (
			!input &&
			entry.type === "custom_message" &&
			entry.customType === "herdr-agent-message" &&
			typeof entry.content === "string" &&
			entry.content
		) {
			input = { id: entry.id, text: entry.content };
			inputDepth = currentDepth;
		}
		const message = entry.message;
		if (message && typeof message === "object") {
			const result = askResult(message);
			if (result && !askResults.has(result[0])) askResults.set(...result);
			if (
				(message.role === "toolResult" || message.role === "tool") &&
				typeof (message.toolCallId ?? message.tool_call_id) === "string"
			)
				resolved.add(message.toolCallId ?? message.tool_call_id);
			if (!assistant) {
				assistant = assistantFromMessage(entry.id, message);
				if (assistant) assistantDepth = currentDepth;
			}
			if (!input) {
				input = inputFromMessage(entry.id, message);
				if (input) inputDepth = currentDepth;
			}
			if (
				!ask &&
				message.role === "assistant" &&
				Array.isArray(message.content)
			)
				ask = [...message.content]
					.reverse()
					.map(askCall)
					.find(
						(candidate) => candidate && !resolved.has(candidate.toolCallId),
					);
		}
		if (typeof entry.parentId !== "string") return true;
		targetId = entry.parentId;
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
				if (inspect(data.subarray(index + 1, lineEnd))) return result();
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

export async function readSessionView(path) {
	if (!path) return {};
	const expanded = expandHome(path);
	let metadata;
	try {
		metadata = await stat(expanded);
	} catch (error) {
		if (error.code === "ENOENT") return {};
		throw error;
	}
	const cached = sessionCache.get(expanded);
	if (cached?.size === metadata.size && cached.mtimeMs === metadata.mtimeMs)
		return cached.result;
	const result = await sessionView(expanded, metadata.size);
	sessionCache.set(expanded, {
		size: metadata.size,
		mtimeMs: metadata.mtimeMs,
		result,
	});
	return result;
}
