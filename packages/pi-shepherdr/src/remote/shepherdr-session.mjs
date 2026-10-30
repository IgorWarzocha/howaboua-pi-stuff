// @howaboua/pi-shepherdr managed bridge

import { open, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** @param {unknown} value @returns {Record<string, unknown> | undefined} */
function record(value) {
	return value && typeof value === "object" && !Array.isArray(value)
		? /** @type {Record<string, unknown>} */ (value)
		: undefined;
}

const READ_CHUNK_BYTES = 64 * 1024;
/** @type {Map<string,{mtimeMs:number,size:number,result:import("../types.js").SessionView}>} */
const sessionCache = new Map();

/** @param {string} path */
function expandHome(path) {
	return path === "~"
		? homedir()
		: path.startsWith("~/")
			? join(homedir(), path.slice(2))
			: path;
}

/** @param {string} id @param {Record<string, unknown>} message @returns {import("../types.js").LatestAssistant | undefined} */
function assistantFromMessage(id, message) {
	if (message["role"] !== "assistant") return undefined;
	const text = [];
	if (typeof message["content"] === "string") text.push(message["content"]);
	else if (Array.isArray(message["content"])) {
		for (const value of message["content"]) {
			const part = record(value);
			if (part && part["type"] === "text" && typeof part["text"] === "string")
				text.push(part["text"]);
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

/** @param {string} id @param {Record<string, unknown>} message @returns {import("../types.js").LatestInput | undefined} */
function inputFromMessage(id, message) {
	if (message["role"] !== "user") return undefined;
	const text = [];
	if (typeof message["content"] === "string") text.push(message["content"]);
	else if (Array.isArray(message["content"])) {
		for (const value of message["content"]) {
			const part = record(value);
			if (part && part["type"] === "text" && typeof part["text"] === "string")
				text.push(part["text"]);
		}
	}
	const joined = text.join("");
	return joined ? { id, text: joined } : undefined;
}

/** @param {unknown} value @returns {import("../types.js").ExtensionMessage | undefined} */
export function readExtensionMessage(value) {
	if (!value || typeof value !== "object" || Array.isArray(value))
		return undefined;
	const data = /** @type {Record<string, unknown>} */ (value);
	if (
		data["version"] !== 1 ||
		data["state"] !== "pending" ||
		typeof data["extension"] !== "string" ||
		!data["extension"].trim() ||
		typeof data["id"] !== "string" ||
		!data["id"].trim() ||
		typeof data["message"] !== "string" ||
		typeof data["blocking"] !== "boolean" ||
		(data["reply"] !== undefined && typeof data["reply"] !== "string")
	)
		return undefined;
	return {
		extension: data["extension"],
		id: data["id"],
		message: data["message"],
		blocking: data["blocking"],
		...(typeof data["reply"] === "string" ? { reply: data["reply"] } : {}),
	};
}

/** @param {{extension:string,id:string}} value */
export function extensionMessageKey(value) {
	return JSON.stringify([value.extension, value.id]);
}

/** @param {string} path @param {number} size @returns {Promise<import("../types.js").SessionView>} */
async function sessionView(path, size) {
	const file = await open(path, "r");
	/** @type {string | undefined} */
	let targetId;
	/** @type {import("../types.js").LatestAssistant | undefined} */
	let assistant;
	let assistantSeen = false;
	let assistantPending = false;
	/** @type {number | undefined} */
	let assistantDepth;
	/** @type {import("../types.js").ExtensionMessage[]} */
	const extensionMessages = [];
	let depth = 0;
	/** @type {import("../types.js").LatestInput | undefined} */
	let input;
	/** @type {number | undefined} */
	let inputDepth;
	const resolved = new Set();
	const result = () => ({
		...(assistant ? { assistant } : {}),
		...(assistantPending ? { assistantPending: true } : {}),
		...(extensionMessages.length ? { extensionMessages } : {}),
		...(input ? { input } : {}),
		...(assistantDepth !== undefined && inputDepth !== undefined
			? { assistantAfterInput: assistantDepth < inputDepth }
			: {}),
	});
	/** @param {Buffer} line */
	const inspect = (line) => {
		if (line.length === 0) return false;
		/** @type {unknown} */
		let parsed;
		try {
			parsed = JSON.parse(line.toString("utf8"));
		} catch {
			return false;
		}
		const entry = record(parsed);
		if (!entry || typeof entry["id"] !== "string") return false;
		targetId ??= entry["id"];
		if (entry["id"] !== targetId) return false;
		const currentDepth = depth;
		depth += 1;
		if (
			entry["type"] === "custom" &&
			entry["customType"] === "shepherdr-extension-message"
		) {
			const update = record(entry["data"]);
			if (
				update?.["version"] === 1 &&
				typeof update["extension"] === "string" &&
				update["extension"].trim() &&
				typeof update["id"] === "string" &&
				update["id"].trim()
			) {
				const key = extensionMessageKey({
					extension: update["extension"],
					id: update["id"],
				});
				if (!resolved.has(key)) {
					if (update["state"] === "closed") resolved.add(key);
					else {
						const pending = readExtensionMessage(update);
						if (pending) {
							extensionMessages.push(pending);
							resolved.add(key);
						}
					}
				}
			}
		}
		if (
			!input &&
			entry["type"] === "custom_message" &&
			entry["customType"] === "herdr-agent-message" &&
			typeof entry["content"] === "string" &&
			entry["content"]
		) {
			input = { id: entry["id"], text: entry["content"] };
			inputDepth = currentDepth;
		}
		const message = record(entry["message"]);
		if (message && typeof message === "object") {
			// Never fall back to an older reply behind a tool call or empty final.
			if (!assistantSeen && message["role"] === "assistant") {
				assistantSeen = true;
				assistantPending = message["stopReason"] === "toolUse";
				if (!assistantPending)
					assistant = assistantFromMessage(entry["id"], message);
				if (assistant) assistantDepth = currentDepth;
			}
			if (!input) {
				input = inputFromMessage(entry["id"], message);
				if (input) inputDepth = currentDepth;
			}
		}
		if (typeof entry["parentId"] !== "string") return true;
		targetId = entry["parentId"];
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
			let lineEnd = data["length"];
			for (let index = data["length"] - 1; index >= 0; index -= 1) {
				if (data[index] !== 0x0a) continue;
				if (inspect(data["subarray"](index + 1, lineEnd))) return result();
				lineEnd = index;
			}
			partial = data["subarray"](0, lineEnd);
		}
		inspect(partial);
		return result();
	} finally {
		await file.close();
	}
}

/** @param {string | undefined} path @returns {Promise<import("../types.js").SessionView>} */
export async function readSessionView(path) {
	if (!path) return {};
	const expanded = expandHome(path);
	let metadata;
	try {
		metadata = await stat(expanded);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT")
			return {};
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
