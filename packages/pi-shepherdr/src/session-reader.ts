import { readFile, stat } from "node:fs/promises";
import type { LatestAssistant } from "./types.js";

interface SessionNode {
	assistant?: LatestAssistant;
	parentId?: string;
}

function latestAssistantFromLines(
	lines: string[],
): LatestAssistant | undefined {
	const nodes = new Map<string, SessionNode>();
	let leafId: string | undefined;
	for (const line of lines) {
		let entry: Record<string, unknown>;
		try {
			entry = JSON.parse(line) as Record<string, unknown>;
		} catch {
			continue;
		}
		if (typeof entry["id"] !== "string") continue;
		const node: SessionNode = {
			...(typeof entry["parentId"] === "string"
				? { parentId: entry["parentId"] }
				: {}),
		};
		const message = entry["message"];
		if (
			typeof message === "object" &&
			message !== null &&
			"role" in message &&
			message.role === "assistant"
		) {
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
			if (joined || stopReason === "error") {
				node.assistant = {
					id: entry["id"],
					text: joined,
					...(stopReason ? { stopReason } : {}),
				};
			}
		}
		nodes.set(entry["id"], node);
		leafId = entry["id"];
	}

	const visited = new Set<string>();
	let current = leafId;
	while (current && !visited.has(current)) {
		visited.add(current);
		const node = nodes.get(current);
		if (!node) break;
		if (node.assistant) return node.assistant;
		current = node.parentId;
	}
	return undefined;
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
		const result = latestAssistantFromLines(
			(await readFile(path, "utf8")).split("\n"),
		);
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
