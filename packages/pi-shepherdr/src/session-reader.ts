import { open, stat } from "node:fs/promises";
import type { LatestAssistant } from "./types.js";

const READ_CHUNK_BYTES = 64 * 1024;

function assistantFromEntry(
	entry: Record<string, unknown>,
): LatestAssistant | undefined {
	const message = entry["message"];
	if (
		typeof message !== "object" ||
		message === null ||
		!("role" in message) ||
		message.role !== "assistant"
	) {
		return undefined;
	}
	const text: string[] = [];
	if ("content" in message && typeof message.content === "string") {
		text.push(message.content);
	} else if ("content" in message && Array.isArray(message.content)) {
		for (const part of message.content) {
			if (
				typeof part === "object" &&
				part !== null &&
				"type" in part &&
				part.type === "text" &&
				"text" in part &&
				typeof part.text === "string"
			) {
				text.push(part.text);
			}
		}
	}
	const joined = text.join("");
	const stopReason =
		"stopReason" in message && typeof message.stopReason === "string"
			? message.stopReason
			: undefined;
	if (!joined && stopReason !== "error") return undefined;
	return {
		id: entry["id"] as string,
		text: joined,
		...(stopReason ? { stopReason } : {}),
	};
}

async function latestAssistant(
	path: string,
	size: number,
): Promise<LatestAssistant | undefined> {
	const file = await open(path, "r");
	let targetId: string | undefined;
	const inspect = (line: Buffer): LatestAssistant | null | undefined => {
		if (line.length === 0) return undefined;
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line.toString("utf8")) as Record<string, unknown>;
		} catch {
			return undefined;
		}
		if (typeof entry["id"] !== "string") return undefined;
		targetId ??= entry["id"];
		if (entry["id"] !== targetId) return undefined;
		const assistant = assistantFromEntry(entry);
		if (assistant) return assistant;
		if (typeof entry["parentId"] !== "string") return null;
		targetId = entry["parentId"];
		return undefined;
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
				const result = inspect(data.subarray(index + 1, lineEnd));
				if (result !== undefined) return result ?? undefined;
				lineEnd = index;
			}
			partial = data.subarray(0, lineEnd);
		}
		const result = inspect(partial);
		return result ?? undefined;
	} finally {
		await file.close();
	}
}

export class SessionReader {
	private readonly cache = new Map<
		string,
		{ mtimeMs: number; result: LatestAssistant | undefined; size: number }
	>();

	async latest(path?: string): Promise<LatestAssistant | undefined> {
		if (!path) return undefined;
		let metadata;
		try {
			metadata = await stat(path);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
			throw error;
		}
		const cached = this.cache.get(path);
		if (cached?.size === metadata.size && cached.mtimeMs === metadata.mtimeMs) {
			return cached.result;
		}
		const result = await latestAssistant(path, metadata.size);
		this.cache.set(path, {
			mtimeMs: metadata.mtimeMs,
			result,
			size: metadata.size,
		});
		return result;
	}
}

export interface AssistantReader {
	latest(path?: string): Promise<LatestAssistant | undefined>;
}
