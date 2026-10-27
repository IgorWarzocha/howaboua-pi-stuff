import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { HistorySearch } from "./history-search.js";
import { buildTreeArchiveIndex } from "./tree-archive.js";
import { windowDetails } from "./windows.js";

interface HistoryItem {
	window_id: string;
	item_id: string;
	role: string;
	tool_name?: string;
	tool_namespace?: string;
	content: string;
}

// Pi entries are immutable once persisted. Rendering is lazy so indexing never
// serializes the ongoing context, and repeated lookups reuse unchanged text.
const rendered = new WeakMap<SessionEntry, string>();
const cachedItems = new WeakMap<SessionEntry, HistoryItem>();
const indexItems = new WeakMap<
	HistoryItem,
	Pick<HistoryItem, "item_id" | "content">
>();
function content(entry: SessionEntry, render: () => string): string {
	let value = rendered.get(entry);
	if (value === undefined) {
		value = render();
		rendered.set(entry, value);
	}
	return value;
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

/** Pi's selected JSONL branch is the archive. */
async function historyWindows(
	entries: readonly SessionEntry[],
	sessionId: string,
	allEntries: readonly SessionEntry[],
	signal?: AbortSignal,
): Promise<{ windows: Map<string, HistoryItem[]>; retired: Set<string> }> {
	const archive = buildTreeArchiveIndex(allEntries, entries);
	if (archive.invalidManifest)
		throw new Error(
			"Saved history could not be read. Open an intact copy of the source session.",
		);
	if (archive.archives.some((item) => !item.entries))
		throw new Error(
			"Archived history is unavailable in this session copy. Resume the source session.",
		);
	const seen = new Set<string>();
	entries = [
		...archive.archives.flatMap((item) => item.entries ?? []),
		...entries,
	].filter((entry) => {
		if (seen.has(entry.id)) return false;
		seen.add(entry.id);
		return true;
	});
	let windowId = `session:${sessionId}`;
	let activeStart = 0;
	const positions = new Map(
		entries.map((entry, position) => [entry.id, position]),
	);
	for (const [position, entry] of entries.entries()) {
		const boundary = windowDetails(entry);
		if (boundary?.kind === "window" && boundary.trim)
			activeStart = position + 1;
		if (entry.type === "compaction") {
			const kept = positions.get(entry.firstKeptEntryId);
			if (kept !== undefined && kept <= position)
				activeStart = Math.max(activeStart, kept);
		}
	}
	const retired = new Set(
		entries.slice(0, activeStart).map((entry) => entry.id),
	);
	const windows = new Map<string, HistoryItem[]>();
	windows.set(windowId, []);
	for (const [position, entry] of entries.entries()) {
		if (position % 512 === 0) {
			await setImmediate();
			signal?.throwIfAborted();
		}
		const boundary = windowDetails(entry);
		if (boundary?.kind === "window") {
			windowId = boundary.identity.currentWindowId;
			if (!windows.has(windowId)) windows.set(windowId, []);
			continue;
		}
		const cached = cachedItems.get(entry);
		if (cached?.window_id === windowId) {
			windows.get(windowId)!.push(cached);
			continue;
		}
		let item: HistoryItem | undefined;
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
			const render = () =>
				!("content" in message)
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
									if (block.type === "image")
										return `[image ${block.mimeType}]`;
									return JSON.stringify(block);
								})
								.join("\n");
			item = {
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
				get content() {
					return content(entry, render);
				},
			};
			if (message.role === "user" || message.role === "assistant") {
				const body = message.content;
				const hasText =
					typeof body === "string"
						? body.length > 0
						: body.some(
								(block) => block.type === "text" && block.text.length > 0,
							);
				let indexedContent: string | undefined;
				if (hasText)
					indexItems.set(item, {
						item_id: item.item_id,
						get content() {
							return (indexedContent ??=
								typeof body === "string"
									? body
									: body
											.filter((block) => block.type === "text")
											.map((block) => block.text)
											.join("\n"));
						},
					});
			}
		} else if (entry.type === "custom_message" && !boundary) {
			item = {
				window_id: windowId,
				item_id: entry.id,
				role: customHistoryRole(entry),
				get content() {
					return content(entry, () =>
						typeof entry.content === "string"
							? entry.content
							: entry.content
									.map((block) =>
										block.type === "text" ? block.text : "[image]",
									)
									.join("\n"),
					);
				},
			};
		}
		if (item) {
			cachedItems.set(entry, item);
			windows.get(windowId)!.push(item);
		}
	}
	return { windows, retired };
}

export async function indexHistory(
	entries: readonly SessionEntry[],
	sessionId: string,
	search: HistorySearch,
	allEntries: readonly SessionEntry[] = entries,
): Promise<void> {
	if (!search.isEnabled(sessionId)) return;
	const { windows, retired } = await historyWindows(
		entries,
		sessionId,
		allEntries,
	);
	const items = [...windows.values()].flat();
	await search.index(
		sessionId,
		items
			.filter((item) => retired.has(item.item_id))
			.flatMap((item) => indexItems.get(item) ?? []),
		undefined,
		items
			.filter((item) => !retired.has(item.item_id) || !indexItems.has(item))
			.map((item) => item.item_id),
	);
}

export async function useHistory(
	entries: readonly SessionEntry[],
	params: Record<string, unknown>,
	sessionId: string,
	search: HistorySearch,
	allEntries: readonly SessionEntry[] = entries,
	signal?: AbortSignal,
	liveAccess = false,
): Promise<Record<string, unknown>> {
	signal?.throwIfAborted();
	const { windows, retired } = await historyWindows(
		entries,
		sessionId,
		allEntries,
		signal,
	);
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
		const windowId = params["window_id"];
		const itemId = params["item_id"];
		if (typeof windowId !== "string" || typeof itemId !== "string")
			throw new Error(
				`history read_item requires ${typeof windowId !== "string" ? "window_id" : "item_id"} as a string. Copy window_id and item_id from the same search_contents or list_items result`,
			);
		const item = windows.get(windowId)?.find((item) => item.item_id === itemId);
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
	const limit = integer(params["limit"], 10, 25);
	let items = [...windows.values()]
		.flat()
		.filter(
			(item) =>
				(!params["window_id"] || item.window_id === params["window_id"]) &&
				(!params["role"] || item.role === params["role"]) &&
				(!params["tool_name"] || item.tool_name === params["tool_name"]) &&
				(!params["tool_namespace"] ||
					item.tool_namespace === params["tool_namespace"]),
		);
	const ranked =
		search.isEnabled(sessionId) &&
		!liveAccess &&
		!params["agent_name"] &&
		(!params["role"] ||
			params["role"] === "user" ||
			params["role"] === "assistant") &&
		!params["tool_name"] &&
		!params["tool_namespace"] &&
		(!params["window_id"] || items.every((item) => retired.has(item.item_id)));
	if (action === "search_contents" && ranked) {
		const canonical = new Map(items.map((item) => [item.item_id, item]));
		const matches = await search.search(
			sessionId,
			items
				.filter((item) => retired.has(item.item_id))
				.flatMap((item) => indexItems.get(item) ?? []),
			params["query"] as string,
			limit,
			params["recent_first"] === true,
			signal,
		);
		items = matches.map((item) => canonical.get(item.item_id)!);
	} else {
		if (action === "search_contents")
			items = items.filter((item) =>
				item.content.includes(params["query"] as string),
			);
		if (params["recent_first"] === true) items = items.reverse();
	}
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

import { setImmediate } from "node:timers/promises";
