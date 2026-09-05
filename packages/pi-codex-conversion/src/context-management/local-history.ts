import type {
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	isCodexContextManagementMessageDetails,
} from "./messages.ts";
import { buildTreeArchiveIndex } from "./tree-archive.ts";

const LIST_ITEM_LIMIT = 25;
const LIST_ITEM_PREVIEW_CHARS = 1_000;
const READ_ITEM_LIMIT_CHARS = 8_000;
const LIST_OUTPUT_LIMIT_CHARS = 8_000;
const RECOVERY_USER_ITEM_LIMIT = 5;

type LocalHistoryAction =
	| "list_windows"
	| "list_items"
	| "read_item"
	| "search_contents";

interface LocalHistoryItem {
	window_id: string;
	item_id: string;
	role: string;
	tool_name?: string | undefined;
	tool_namespace?: string | undefined;
	content: string;
	summary?: true | undefined;
}

interface LocalHistoryWindow {
	window_id: string;
	items: LocalHistoryItem[];
}

export interface LocalHistoryRecoveryHint {
	window_id: string;
	summary_item_id?: string | undefined;
	user_item_ids?: string[] | undefined;
}

export function getPiSessionHistoryRecoveryHint(
	ctx: ExtensionContext,
	mode: ContextManagementMode,
): LocalHistoryRecoveryHint | undefined {
	if (mode !== "local" && mode !== "tree") return undefined;
	let window = latestWindowEntries(ctx.sessionManager.getBranch());
	let summaryItemId: string | undefined;
	if (mode === "tree" && !window) {
		const index = buildTreeArchiveIndex(
			ctx.sessionManager.getEntries(),
			ctx.sessionManager.getBranch(),
		);
		if (index.invalidManifest) return undefined;
		const archive = index.archives.at(-1);
		if (!archive) return undefined;
		window = {
			windowId: archive.manifest.windowId,
			entries: archive.entries,
		};
		summaryItemId = archive.summary.id;
	}
	if (!window) return undefined;
	const userItemIds = window.entries
		.filter(
			(entry) =>
				entry.type === "message" && entry.message.role === "user",
		)
		.slice(-RECOVERY_USER_ITEM_LIMIT)
		.reverse()
		.map((entry) => entry.id);
	if (!summaryItemId && userItemIds.length === 0) return undefined;
	return {
		window_id: window.windowId,
		...(summaryItemId ? { summary_item_id: summaryItemId } : {}),
		...(userItemIds.length > 0 ? { user_item_ids: userItemIds } : {}),
	};
}

export function readPiSessionHistory(
	action: LocalHistoryAction,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	mode: ContextManagementMode = "local",
): Record<string, unknown> {
	const windows = mode === "tree"
		? collectTreeWindows(
			ctx.sessionManager.getEntries(),
			ctx.sessionManager.getBranch(),
		)
		: collectWindows(ctx.sessionManager.getBranch());
	if (!isCurrentAgent(params["agent_name"]))
		return action === "list_windows" ? { windows: [] } : { items: [] };
	if (action === "list_windows") {
		const ordered = params["recent_first"] === true ? [...windows].reverse() : windows;
		return {
			source: "pi-session",
			windows: ordered.slice(0, integer(params["limit"], 20, 100)).map((window) => ({
				window_id: window.window_id,
				item_count: window.items.length,
			})),
		};
	}
	if (action === "read_item") return readItem(windows, params);
	const query = action === "search_contents" ? string(params["query"]) : undefined;
	let items = windows.flatMap((window) => window.items);
	const windowId = nullableString(params["window_id"]);
	if (windowId) items = items.filter((item) => item.window_id === windowId);
	const role = nullableString(params["role"]);
	if (role) items = items.filter((item) => item.role === role);
	const toolName = nullableString(params["tool_name"]);
	if (toolName) items = items.filter((item) => item.tool_name === toolName);
	const toolNamespace = nullableString(params["tool_namespace"]);
	if (toolNamespace)
		items = items.filter((item) => item.tool_namespace === toolNamespace);
	if (query) items = items.filter((item) => item.content.includes(query));
	if (mode === "tree" && query) {
		const summaries = items.filter((item) => item.summary);
		const raw = items.filter((item) => !item.summary);
		if (params["recent_first"] === true) {
			summaries.reverse();
			raw.reverse();
		}
		items = [...summaries, ...raw];
	} else if (params["recent_first"] === true) items.reverse();
	const previews = boundedPreviews(
		items,
		integer(params["limit"], 10, LIST_ITEM_LIMIT),
		integer(
			params["max_chars_per_item"],
			LIST_ITEM_PREVIEW_CHARS,
			LIST_ITEM_PREVIEW_CHARS,
		),
	);
	return {
		source: "pi-session",
		items: previews,
	};
}

function collectWindows(entries: readonly SessionEntry[]): LocalHistoryWindow[] {
	const windows: LocalHistoryWindow[] = [];
	let current: LocalHistoryWindow | undefined;
	for (const entry of entries) {
		if (
			entry.type === "custom_message" &&
			entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE
		) {
			const details = entry.details as {
				contextManagement?: { kind?: unknown; currentWindowId?: unknown };
			} | undefined;
			if (
				details?.contextManagement?.kind === "window" &&
				typeof details.contextManagement.currentWindowId === "string"
			) {
				current = {
					window_id: details.contextManagement.currentWindowId,
					items: [],
				};
				windows.push(current);
			}
			continue;
		}
		if (!current) continue;
		const item = historyItem(entry, current.window_id);
		if (item) current.items.push(item);
	}
	return windows;
}

function collectTreeWindows(
	allEntries: readonly SessionEntry[],
	activeBranch: readonly SessionEntry[],
): LocalHistoryWindow[] {
	const index = buildTreeArchiveIndex(allEntries, activeBranch);
	const archived = index.archives.map(({ manifest, summary, entries }) => ({
		window_id: manifest.windowId,
		items: [
			{
				window_id: manifest.windowId,
				item_id: summary.id,
				role: "assistant",
				content: summary.summary,
				summary: true as const,
			},
			...entries.flatMap((entry) => {
				if (
					entry.type === "custom_message" &&
					entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE
				)
					return [];
				const item = historyItem(entry, manifest.windowId);
				return item ? [item] : [];
			}),
		],
	}));
	const current = collectWindows(activeBranch).at(-1);
	return current ? [...archived, current] : archived;
}

function latestWindowEntries(
	entries: readonly SessionEntry[],
): { windowId: string; entries: readonly SessionEntry[] } | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (
			entry.type !== "custom_message" ||
			entry.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE ||
			!isCodexContextManagementMessageDetails(entry.details) ||
			entry.details.contextManagement.kind !== "window"
		)
			continue;
		return {
			windowId: entry.details.contextManagement.currentWindowId,
			entries: entries.slice(index + 1),
		};
	}
	return undefined;
}

function historyItem(
	entry: SessionEntry,
	windowId: string,
): LocalHistoryItem | undefined {
	if (entry.type === "custom_message") {
		if (typeof entry.content !== "string") return undefined;
		return {
			window_id: windowId,
			item_id: entry.id,
			role: "developer",
			content: entry.content,
		};
	}
	if (entry.type !== "message") return undefined;
	const message = entry.message as unknown as Record<string, unknown>;
	const role = typeof message["role"] === "string" ? message["role"] : "unknown";
	const tool = toolIdentityFromMessage(message);
	return {
		window_id: windowId,
		item_id: entry.id,
		role: role === "toolResult" ? "tool" : role,
		...(tool?.name ? { tool_name: tool.name } : {}),
		...(tool?.namespace ? { tool_namespace: tool.namespace } : {}),
		content: renderMessage(message),
	};
}

function toolIdentityFromMessage(
	message: Record<string, unknown>,
): { name: string; namespace?: string } | undefined {
	if (typeof message["toolName"] === "string")
		return { name: message["toolName"] };
	if (!Array.isArray(message["content"])) return undefined;
	const call = message["content"].find(
		(item): item is Record<string, unknown> =>
			isRecord(item) &&
			item["type"] === "toolCall" &&
			typeof item["name"] === "string",
	);
	if (!call) return undefined;
	const namespace = typeof call["namespace"] === "string"
		? call["namespace"]
		: undefined;
	const arguments_ = isRecord(call["arguments"])
		? call["arguments"]
		: undefined;
	const routedAction =
		(call["name"] === "history" || call["name"] === "notes") &&
		call["name"] === namespace &&
		typeof arguments_?.["action"] === "string"
			? arguments_["action"] as string
			: undefined;
	return {
		name: routedAction ?? call["name"] as string,
		...(namespace ? { namespace } : {}),
	};
}

function renderMessage(message: Record<string, unknown>): string {
	const content = message["content"];
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return JSON.stringify(message);
	return content.map((item) => {
		if (!isRecord(item)) return String(item);
		if (typeof item["text"] === "string") return item["text"];
		if (typeof item["thinking"] === "string") return item["thinking"];
		if (item["type"] === "image")
			return `[image ${typeof item["mimeType"] === "string" ? item["mimeType"] : "attachment"}]`;
		if (item["type"] === "toolCall")
			return JSON.stringify({
				tool: item["name"],
				arguments: item["arguments"],
			});
		return JSON.stringify(item);
	}).join("\n");
}

function readItem(
	windows: readonly LocalHistoryWindow[],
	params: Record<string, unknown>,
): Record<string, unknown> {
	const windowId = string(params["window_id"]);
	const itemId = string(params["item_id"]);
	const item = windows
		.find((window) => window.window_id === windowId)
		?.items.find(
			(candidate) =>
				candidate.item_id === itemId || candidate.item_id.endsWith(itemId),
		);
	if (!item) return { source: "pi-session", item: null };
	const offset = integer(params["offset_chars"], 0, item.content.length);
	const limit = integer(
		params["limit_chars"],
		READ_ITEM_LIMIT_CHARS,
		READ_ITEM_LIMIT_CHARS,
	);
	const content = item.content.slice(offset, offset + limit);
	const nextOffset = offset + content.length;
	return {
		source: "pi-session",
		item: {
			window_id: item.window_id,
			item_id: item.item_id,
			role: item.role,
			...(item.tool_name ? { tool_name: item.tool_name } : {}),
			...(item.tool_namespace ? { tool_namespace: item.tool_namespace } : {}),
			content,
			total_chars: item.content.length,
			...(nextOffset < item.content.length
				? { next_offset_chars: nextOffset }
				: {}),
		},
	};
}

function boundedPreviews(
	items: readonly LocalHistoryItem[],
	limit: number,
	maxChars: number,
): Array<Record<string, unknown>> {
	const result: Array<Record<string, unknown>> = [];
	let size = 0;
	for (const item of items) {
		if (result.length >= limit) break;
		const preview = {
			window_id: item.window_id,
			item_id: item.item_id,
			role: item.role,
			...(item.tool_name ? { tool_name: item.tool_name } : {}),
			...(item.tool_namespace ? { tool_namespace: item.tool_namespace } : {}),
			truncated_content: item.content.slice(0, maxChars),
			content_chars: item.content.length,
		};
		const previewSize = JSON.stringify(preview).length;
		if (result.length > 0 && size + previewSize > LIST_OUTPUT_LIMIT_CHARS) break;
		result.push(preview);
		size += previewSize;
	}
	return result;
}

function integer(value: unknown, fallback: number, maximum: number): number {
	return typeof value === "number" && Number.isInteger(value)
		? Math.max(0, Math.min(value, maximum))
		: fallback;
}

function nullableString(value: unknown): string | undefined {
	return typeof value === "string" && value !== "" ? value : undefined;
}

function string(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function isCurrentAgent(value: unknown): boolean {
	return value === undefined || value === null || value === "" || value === "/root";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
