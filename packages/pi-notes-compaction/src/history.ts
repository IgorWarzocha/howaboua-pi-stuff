import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import type { HistorySearch } from "./history-search.js";
import { historyWindows } from "./history-windows.js";

export async function indexHistory(
	entries: readonly SessionEntry[],
	sessionId: string,
	search: HistorySearch,
	allEntries: readonly SessionEntry[] = entries,
): Promise<void> {
	if (!search.isEnabled(sessionId)) return;
	const { windows, retired, indexItems } = await historyWindows(
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
	const { windows, retired, indexItems } = await historyWindows(
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
				`history read requires ${typeof windowId !== "string" ? "window_id" : "item_id"} as a string. Copy window_id and item_id from the same search or list result`,
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
