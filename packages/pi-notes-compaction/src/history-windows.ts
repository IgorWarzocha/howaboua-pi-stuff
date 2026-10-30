import { setImmediate } from "node:timers/promises";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildTreeArchiveIndex } from "./tree-archive.js";
import { windowDetails } from "./window-message.js";

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
export async function historyWindows(
	entries: readonly SessionEntry[],
	sessionId: string,
	allEntries: readonly SessionEntry[],
	signal?: AbortSignal,
): Promise<{
	windows: Map<string, HistoryItem[]>;
	retired: Set<string>;
	indexItems: Pick<typeof indexItems, "get" | "has">;
}> {
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
	return { windows, retired, indexItems };
}
