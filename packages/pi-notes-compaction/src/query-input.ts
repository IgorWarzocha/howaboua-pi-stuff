import type { LookupQuery } from "./bridge.js";

const ACTIONS: Record<LookupQuery["namespace"], Record<string, string>> = {
	notes: {
		list_files_by_prefix: "list",
		read_file: "read",
		search_contents: "search",
		append_to_file: "append",
		write_file: "write",
	},
	history: { list_items: "list", read_item: "read", search_contents: "search" },
};
const HINTS = [
	"limit",
	"max_results",
	"max_files",
	"max_matches_per_file",
	"file_order",
	"file_order_by",
	"recent_file_first",
	"recent_first",
	"limit_chars",
	"max_chars_per_item",
];
const PRESENTATION: Record<string, readonly string[]> = {
	"notes:list": ["limit", "file_order", "file_order_by"],
	"notes:search": ["limit", "max_matches_per_file", "recent_file_first"],
	"notes:read": ["start_line", "stop_line"],
	"history:list_windows": ["limit", "recent_first"],
	"history:list": ["limit", "recent_first", "max_chars_per_item"],
	"history:search": ["limit", "recent_first"],
	"history:read": ["limit_chars", "offset_chars"],
};

function alias(params: Record<string, unknown>, from: string, to: string) {
	if (!(from in params)) return;
	if (to in params && params[to] !== params[from])
		throw new Error(`Conflicting ${to} and ${from}; supply only ${to}`);
	params[to] = params[from];
	delete params[from];
}

/** Accept familiar spellings without adding competing names to discovery. */
export function normalizeQueryInput(
	namespace: LookupQuery["namespace"],
	input: unknown,
): Record<string, unknown> {
	if (input === undefined) return {};
	if (typeof input === "string") {
		try {
			input = JSON.parse(input);
		} catch {
			throw new Error(
				"Supply an action object or valid JSON object; use {} for help",
			);
		}
	}
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Supply an action object; use {} for help");
	const params = { ...input } as Record<string, unknown>;
	const action =
		ACTIONS[namespace][String(params["action"])] ?? params["action"];
	if (action !== undefined) params["action"] = action;
	if (namespace === "notes") {
		if (action === "write" || action === "append")
			alias(params, "content", "text");
		if (action === "list" || action === "search") {
			alias(params, "prefix", "path");
			alias(params, "path_prefix", "path");
			alias(params, "max_results", "limit");
			alias(params, "max_files", "limit");
			if (action === "search")
				alias(params, "recent_first", "recent_file_first");
		}
	} else if (["list", "search", "list_windows"].includes(String(action))) {
		alias(params, "max_results", "limit");
	}
	const used = PRESENTATION[`${namespace}:${String(action)}`] ?? [];
	for (const hint of HINTS) if (!used.includes(hint)) delete params[hint];
	return params;
}

/** Keep persisted sharing requests and backend endpoint names unchanged. */
export function internalQueryArguments(
	namespace: LookupQuery["namespace"],
	input: Record<string, unknown>,
) {
	const params = { ...input };
	const action = params["action"];
	params["action"] =
		Object.entries(ACTIONS[namespace]).find(
			([, value]) => value === action,
		)?.[0] ?? action;
	if (namespace === "notes") {
		if (action === "list" || action === "search") {
			alias(params, "path", action === "list" ? "prefix" : "path_prefix");
			alias(params, "limit", action === "list" ? "max_results" : "max_files");
		}
	}
	return params;
}

export function isNoteWrite(input: unknown): boolean {
	try {
		if (typeof input === "string") input = JSON.parse(input);
		if (!input || typeof input !== "object" || !("action" in input))
			return false;
		// Failed write attempts still invalidate freshness; do not validate their fields here.
		return ["write", "append", "write_file", "append_to_file"].includes(
			String(input.action),
		);
	} catch {
		return false;
	}
}
