import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { windowDetails } from "./windows.js";

interface HistoryItem {
	window_id: string;
	item_id: string;
	role: string;
	tool_name?: string;
	tool_namespace?: string;
	content: string;
}

function customHistoryRole(
	entry: Extract<SessionEntry, { type: "custom_message" }>,
): string {
	// Persisted developer metadata is a wire contract, not a package dependency.
	const details = entry.details;
	const metadata =
		details &&
		typeof details === "object" &&
		"@howaboua/pi-codex-conversion/developer-message" in details
			? details["@howaboua/pi-codex-conversion/developer-message"]
			: [
						"codex-developer-message",
						"codex-context-window",
						"codex-current-time-reminder",
						"codex-toolkit-update",
						"codex-notebook-status",
						"codex-context-briefing",
					].includes(entry.customType)
				? details
				: undefined;
	return metadata &&
		typeof metadata === "object" &&
		"protocol" in metadata &&
		metadata.protocol === 1 &&
		"id" in metadata &&
		typeof metadata.id === "string" &&
		metadata.id.trim() !== ""
		? "developer"
		: "user";
}

/** Pi's selected JSONL branch is the archive. No transcript database or Tree backend. */
export function useHistory(
	entries: readonly SessionEntry[],
	params: Record<string, unknown>,
	sessionId: string,
): Record<string, unknown> {
	let windowId = `session:${sessionId}`;
	const windows = new Map<string, HistoryItem[]>();
	windows.set(windowId, []);
	for (const entry of entries) {
		const boundary = windowDetails(entry);
		if (boundary?.kind === "window") {
			windowId = boundary.identity.currentWindowId;
			if (!windows.has(windowId)) windows.set(windowId, []);
			continue;
		}
		if (entry.type === "message") {
			const message = entry.message;
			const call =
				message.role === "assistant"
					? message.content.find((block) => block.type === "toolCall")
					: undefined;
			const toolName =
				message.role === "toolResult"
					? message.toolName
					: call?.type === "toolCall"
						? call.name
						: undefined;
			const content = !("content" in message)
				? JSON.stringify(message)
				: typeof message.content === "string"
					? message.content
					: message.content
							.map((block) => {
								if (block.type === "text") return block.text;
								if (block.type === "thinking") return block.thinking;
								if (block.type === "toolCall")
									return JSON.stringify({
										tool: block.name,
										arguments: block.arguments,
									});
								if (block.type === "image") return `[image ${block.mimeType}]`;
								return JSON.stringify(block);
							})
							.join("\n");
			windows.get(windowId)!.push({
				window_id: windowId,
				item_id: entry.id,
				role: message.role === "toolResult" ? "tool" : message.role,
				...(toolName
					? {
							tool_name: toolName,
							...(["notes", "history"].includes(toolName)
								? { tool_namespace: toolName }
								: {}),
						}
					: {}),
				content,
			});
		} else if (entry.type === "custom_message" && !boundary) {
			windows.get(windowId)!.push({
				window_id: windowId,
				item_id: entry.id,
				role: customHistoryRole(entry),
				content:
					typeof entry.content === "string"
						? entry.content
						: entry.content
								.map((block) =>
									block.type === "text" ? block.text : "[image]",
								)
								.join("\n"),
			});
		}
	}
	const action = params["action"];
	if (action === "list_windows") {
		let values = [...windows].filter(([, items]) => items.length);
		if (params["recent_first"] === true) values = values.reverse();
		const limit = integer(params["limit"], 20, 100);
		return {
			windows: values
				.slice(0, limit)
				.map(([id, items]) => ({ window_id: id, item_count: items.length })),
			truncated: values.length > limit,
		};
	}
	if (action === "read_item") {
		if (
			typeof params["window_id"] !== "string" ||
			typeof params["item_id"] !== "string"
		)
			throw new Error("Supply window_id and item_id unchanged from history");
		const item = windows
			.get(params["window_id"])
			?.find((item) => item.item_id === params["item_id"]);
		if (!item) return { item: null };
		const offset = integer(params["offset_chars"], 0, item.content.length);
		const limit = integer(params["limit_chars"], 8000, 8000);
		const content = item.content.slice(offset, offset + limit);
		return {
			item: {
				...item,
				content,
				total_chars: item.content.length,
				...(offset + content.length < item.content.length
					? { next_offset_chars: offset + content.length }
					: {}),
			},
		};
	}
	if (action !== "list_items" && action !== "search_contents")
		throw new Error("Unknown history action");
	if (
		action === "search_contents" &&
		(typeof params["query"] !== "string" || !params["query"])
	)
		throw new Error("Supply a nonempty search query");
	let items = [...windows.values()]
		.flat()
		.filter(
			(item) =>
				(!params["window_id"] || item.window_id === params["window_id"]) &&
				(!params["role"] || item.role === params["role"]) &&
				(!params["tool_name"] || item.tool_name === params["tool_name"]) &&
				(!params["tool_namespace"] ||
					item.tool_namespace === params["tool_namespace"]) &&
				(action !== "search_contents" ||
					item.content.includes(params["query"] as string)),
		);
	if (params["recent_first"] === true) items = items.reverse();
	const limit = integer(params["limit"], 10, 25);
	const previewChars = integer(params["max_chars_per_item"], 1000, 1000);
	const previews = [];
	let size = 0;
	for (const item of items) {
		const { content, ...metadata } = item;
		const preview = {
			...metadata,
			truncated_content: content.slice(0, previewChars),
			content_chars: content.length,
		};
		const chars = JSON.stringify(preview).length;
		if (previews.length >= limit || size + chars > 8000) break;
		previews.push(preview);
		size += chars;
	}
	return { items: previews, truncated: previews.length < items.length };
}

function integer(value: unknown, fallback: number, max: number): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.max(0, Math.min(value, max))
		: fallback;
}
