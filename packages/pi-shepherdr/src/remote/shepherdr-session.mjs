// @howaboua/pi-shepherdr managed bridge

import { createHash } from "node:crypto";
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
/** @typedef {{leaf:string|undefined,entries:Record<string,unknown>[],result:import("../types.js").SessionView}} ViewSummary */
/** @type {Map<string,{mtimeMs:number,ctimeMs:number,ino:number,dev:number,size:number,digest:string,terminated:boolean,summary:ViewSummary}>} */
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

/** Verify the whole prefix: native Pi can rewrite a file in place, even to a larger size.
 * @param {import("node:fs/promises").FileHandle} file
 * @param {number} size
 * @param {{size:number,digest:string}|undefined} cached
 */
async function fingerprint(file, size, cached) {
	const hash = createHash("sha256");
	const buffer = Buffer.allocUnsafe(1024 * 1024);
	let position = 0;
	let prefixMatches = false;
	let terminated = false;
	while (position < size) {
		const boundary = cached && position < cached.size ? cached.size : size;
		const length = Math.min(buffer.length, boundary - position);
		const { bytesRead } = await file.read(buffer, 0, length, position);
		if (!bytesRead) break;
		hash.update(buffer.subarray(0, bytesRead));
		position += bytesRead;
		terminated = buffer[bytesRead - 1] === 0x0a;
		if (position === cached?.size)
			prefixMatches = hash.copy().digest("hex") === cached.digest;
	}
	return {
		digest: hash.digest("hex"),
		prefixMatches,
		terminated,
		complete: position === size,
	};
}

/** @param {import("node:fs/promises").FileHandle} file @param {number} size
 * @param {{size:number,summary:ViewSummary}|undefined} cached
 * @returns {Promise<ViewSummary>}
 */
async function sessionView(file, size, cached) {
	/** @type {string | undefined} */
	let leaf;
	/** @type {Record<string,unknown>[]} */
	const entries = [];
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
	/** Only retain semantic records, never image/tool payloads or the whole transcript.
	 * @param {Record<string,unknown>} entry
	 */
	const consume = (entry) => {
		if (typeof entry["id"] !== "string") return;
		/** @type {Record<string,unknown>} */
		const retained = { id: entry["id"], type: entry["type"] };
		let keep = false;
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
					if (update["state"] === "closed") {
						// Suppress older pending records; closures need no cached replay.
						resolved.add(key);
					} else {
						const pending = readExtensionMessage(update);
						if (pending) {
							extensionMessages.push(pending);
							resolved.add(key);
							retained["data"] = { version: 1, state: "pending", ...pending };
							keep = true;
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
			retained["content"] = input.text;
			keep = true;
		}
		const message = record(entry["message"]);
		if (message && typeof message === "object") {
			// Empty notice-only turns must not hide this task's useful final reply.
			// Never cross a tool call or the latest task input to find one.
			if (!assistantSeen && message["role"] === "assistant") {
				if (message["stopReason"] === "toolUse") {
					assistantSeen = true;
					assistantPending = !assistant;
					retained["message"] = { role: "assistant", stopReason: "toolUse" };
					keep = true;
				} else {
					const candidate = assistantFromMessage(entry["id"], message);
					retained["message"] = {
						role: "assistant",
						content: candidate?.text,
						stopReason: candidate?.stopReason,
					};
					if (
						!assistant ||
						candidate?.text ||
						candidate?.stopReason !== "stop"
					) {
						assistant = candidate;
						if (assistant) assistantDepth = currentDepth;
						keep = true;
					}
					assistantSeen = !!candidate?.text || candidate?.stopReason !== "stop";
				}
			}
			if (!input) {
				input = inputFromMessage(entry["id"], message);
				if (input) {
					inputDepth = currentDepth;
					retained["message"] = { role: "user", content: input.text };
					keep = true;
				}
			}
		}
		if (input) assistantSeen = true;
		if (keep) {
			if (entry["customType"] !== undefined)
				retained["customType"] = entry["customType"];
			entries.push(retained);
		}
	};
	const summary = () => ({ leaf, entries, result: result() });
	/** @param {Buffer} line */
	const inspect = (line) => {
		if (line.length === 0) return false;
		let parsed;
		try {
			parsed = JSON.parse(line.toString("utf8"));
		} catch {
			return false;
		}
		const entry = record(parsed);
		if (!entry || typeof entry["id"] !== "string") return false;
		leaf ??= entry["id"];
		targetId ??= entry["id"];
		if (entry["id"] !== targetId) return false;
		consume(entry);
		if (typeof entry["parentId"] !== "string") return true;
		targetId = entry["parentId"];
		return false;
	};

	let position = size;
	const boundary = cached?.size ?? 0;
	/** @type {Buffer[]} Fragments in reverse file order; join only at a newline. */
	let fragments = [];
	/** @param {Buffer} prefix */
	const finishLine = (prefix) => {
		if (!fragments.length) return inspect(prefix);
		fragments.push(prefix);
		const line = Buffer.concat(fragments.reverse());
		fragments = [];
		return inspect(line);
	};
	while (position > boundary) {
		const length = Math.min(READ_CHUNK_BYTES, position - boundary);
		position -= length;
		const chunk = Buffer.allocUnsafe(length);
		const { bytesRead } = await file.read(chunk, 0, length, position);
		let lineEnd = bytesRead;
		for (let index = bytesRead - 1; index >= 0; index -= 1) {
			if (chunk[index] !== 0x0a) continue;
			if (finishLine(chunk.subarray(index + 1, lineEnd))) return summary();
			lineEnd = index;
		}
		if (lineEnd) fragments.push(chunk.subarray(0, lineEnd));
	}
	if (finishLine(Buffer.alloc(0))) return summary();
	if (cached) {
		if (targetId !== undefined && targetId !== cached.summary.leaf)
			return sessionView(file, size, undefined);
		leaf ??= cached.summary.leaf;
		for (const entry of cached.summary.entries) consume(entry);
	}
	return summary();
}

/** @param {string | undefined} path @returns {Promise<import("../types.js").SessionView>} */
export async function readSessionView(path) {
	if (!path) return {};
	const expanded = expandHome(path);
	let metadata;
	try {
		metadata = await stat(expanded);
	} catch (error) {
		if (error instanceof Error && "code" in error && error.code === "ENOENT") {
			sessionCache.delete(expanded);
			return {};
		}
		throw error;
	}
	const cached = sessionCache.get(expanded);
	const sameFile = cached?.ino === metadata.ino && cached.dev === metadata.dev;
	if (
		sameFile &&
		cached.size === metadata.size &&
		cached.mtimeMs === metadata.mtimeMs &&
		cached.ctimeMs === metadata.ctimeMs
	)
		return cached.summary.result;
	const file = await open(expanded, "r");
	try {
		metadata = await file.stat();
		const candidate =
			sameFile && cached.terminated && cached.size < metadata.size
				? cached
				: undefined;
		const fingerprinted = await fingerprint(file, metadata.size, candidate);
		const summary = await sessionView(
			file,
			metadata.size,
			fingerprinted.prefixMatches ? candidate : undefined,
		);
		const after = await file.stat();
		// Never publish a cache built across a concurrent append, rewrite or truncation.
		if (
			fingerprinted.complete &&
			after.size === metadata.size &&
			after.mtimeMs === metadata.mtimeMs &&
			after.ctimeMs === metadata.ctimeMs
		) {
			sessionCache.set(expanded, {
				size: metadata.size,
				mtimeMs: metadata.mtimeMs,
				ctimeMs: metadata.ctimeMs,
				ino: metadata.ino,
				dev: metadata.dev,
				digest: fingerprinted.digest,
				terminated: fingerprinted.terminated,
				summary,
			});
		} else sessionCache.delete(expanded);
		return summary.result;
	} finally {
		await file.close();
	}
}

/** Native session identity only; never create or load an entire transcript.
 * @param {string} path
 * @returns {Promise<{id:string,cwd:string}>}
 */
export async function readSessionHeader(path) {
	const file = await open(expandHome(path), "r").catch((cause) => {
		throw new Error(
			"Saved worker session could not be opened; check that its file is available on the original machine",
			{ cause },
		);
	});
	try {
		const bytes = Buffer.alloc(64 * 1024);
		let size = 0;
		while (size < bytes.length) {
			const read = await file.read(bytes, size, bytes.length - size, size);
			size += read.bytesRead;
			const end = bytes.subarray(0, size).indexOf(10);
			if (end >= 0 || read.bytesRead === 0) {
				const header = record(
					JSON.parse(bytes.subarray(0, end < 0 ? size : end).toString("utf8")),
				);
				if (
					header?.["type"] !== "session" ||
					typeof header["id"] !== "string" ||
					!header["id"] ||
					typeof header["cwd"] !== "string" ||
					!header["cwd"]
				)
					throw new Error(
						"Saved worker has no valid Pi session header; open its saved session manually",
					);
				return { id: header["id"], cwd: header["cwd"] };
			}
		}
		throw new Error(
			"Saved worker session header is too large; open its saved session manually",
		);
	} finally {
		await file.close();
	}
}
