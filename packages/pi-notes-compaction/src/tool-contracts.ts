import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { LookupQuery } from "./bridge.js";

const NOTES_ACTIONS = [
	"help",
	"list_files_by_prefix",
	"read_file",
	"search_contents",
	"append_to_file",
	"write_file",
] as const;
const HISTORY_ACTIONS = [
	"help",
	"list_windows",
	"list_items",
	"read_item",
	"search_contents",
] as const;
export const NOTES_USAGE = "await tools.notes()";
export const HISTORY_USAGE = "await tools.history()";
export const NOTES_DESCRIPTION =
	"Persistent notes for handing off task state between context windows";
export const GPT_NOTES_DESCRIPTION =
	"Persistent notes: task state handoff between context windows";
export const NEW_CONTEXT_DESCRIPTION =
	"Start fresh from saved notes; recover earlier conversation through history";
export const GPT_NEW_CONTEXT_DESCRIPTION =
	"Saved notes→fresh context; earlier conversation→history";
const STRING = Type.Optional(Type.String());
const INTEGER = Type.Optional(Type.Integer({ minimum: 1 }));
const NULLABLE_STRING = Type.Optional(Type.Union([Type.String(), Type.Null()]));
const LINE = Type.Optional(Type.Union([Type.Integer(), Type.Null()]));
export const NOTES_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum([...NOTES_ACTIONS, "read"])),
		path: STRING,
		text: STRING,
		prefix: NULLABLE_STRING,
		query: STRING,
		path_prefix: NULLABLE_STRING,
		start_line: LINE,
		stop_line: LINE,
		max_results: INTEGER,
		max_files: INTEGER,
		max_matches_per_file: INTEGER,
		file_order: Type.Optional(StringEnum(["ascending", "descending"])),
		file_order_by: Type.Optional(
			StringEnum(["name", "created_at", "updated_at"]),
		),
		recent_file_first: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export const HISTORY_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum(HISTORY_ACTIONS)),
		agent_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		item_id: STRING,
		window_id: Type.Optional(
			Type.Union([Type.String(), Type.Null()], {
				description: "Required with item_id for read_item",
			}),
		),
		query: STRING,
		limit: INTEGER,
		limit_chars: INTEGER,
		max_chars_per_item: INTEGER,
		offset_chars: Type.Optional(Type.Integer({ minimum: 0 })),
		recent_first: Type.Optional(Type.Boolean()),
		role: Type.Optional(
			Type.Union([
				StringEnum(["user", "assistant", "tool", "system", "developer"]),
				Type.Null(),
			]),
		),
		tool_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		tool_namespace: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ additionalProperties: false },
);

const FIELDS: Record<string, readonly string[]> = {
	list_files_by_prefix: [
		"prefix",
		"file_order",
		"file_order_by",
		"max_results",
	],
	read_file: ["path", "start_line", "stop_line"],
	search_notes: [
		"query",
		"path_prefix",
		"max_files",
		"max_matches_per_file",
		"recent_file_first",
	],
	append_to_file: ["path", "text"],
	write_file: ["path", "text"],
	list_windows: ["agent_name", "limit", "recent_first"],
	list_items: [
		"agent_name",
		"window_id",
		"role",
		"tool_name",
		"tool_namespace",
		"limit",
		"max_chars_per_item",
		"recent_first",
	],
	read_item: [
		"agent_name",
		"window_id",
		"item_id",
		"offset_chars",
		"limit_chars",
	],
	search_history: [
		"agent_name",
		"window_id",
		"role",
		"tool_name",
		"tool_namespace",
		"query",
		"limit",
		"recent_first",
	],
};
export function queryArguments(
	namespace: LookupQuery["namespace"],
	input: unknown,
): Record<string, unknown> {
	if (!input || typeof input !== "object" || Array.isArray(input))
		throw new Error("Supply an action object");
	const params = input as Record<string, unknown>;
	const action = params["action"];
	const key =
		action === "search_contents" ? `search_${namespace}` : String(action);
	const fields = FIELDS[key];
	if (!fields)
		throw new Error(
			namespace === "notes"
				? "notes requires a supported action"
				: "Unknown action",
		);
	if (namespace === "notes") {
		for (const field of Object.keys(params))
			if (field !== "action" && !fields.includes(field))
				throw new Error(`notes ${String(action)} does not accept ${field}`);
		if (
			["read_file", "write_file", "append_to_file"].includes(String(action)) &&
			(typeof params["path"] !== "string" || !params["path"])
		)
			throw new Error(`notes ${String(action)} requires path`);
		if (
			action === "search_contents" &&
			(typeof params["query"] !== "string" || !params["query"])
		)
			throw new Error("notes search_contents requires query");
		if (
			["write_file", "append_to_file"].includes(String(action)) &&
			typeof params["text"] !== "string"
		)
			throw new Error(`notes ${String(action)} requires text`);
	}
	return Object.fromEntries(
		Object.entries(params).filter(
			([key]) => key === "action" || fields.includes(key),
		),
	);
}

export function result(payload: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		details: {},
	};
}

export function queryHelp(
	namespace: LookupQuery["namespace"],
	input: unknown,
	rankedHistory = false,
	gpt = false,
): AgentToolResult<unknown> | undefined {
	const params = input === undefined ? {} : input;
	if (!params || typeof params !== "object" || Array.isArray(params))
		throw new Error("Supply an action object, or omit arguments for help");
	const entries = Object.entries(params);
	if (
		!entries.length ||
		(params as Record<string, unknown>)["action"] === "help"
	) {
		if (entries.some(([key]) => key !== "action"))
			throw new Error("Help accepts only action: help");
		const actions = namespace === "notes" ? NOTES_ACTIONS : HISTORY_ACTIONS;
		return result({
			actions: Object.fromEntries(
				actions.map((action) => [
					action,
					action === "help"
						? ""
						: FIELDS[
								action === "search_contents" ? `search_${namespace}` : action
							]!.map((field) =>
								["path", "text", "query", "item_id"].includes(field) ||
								(action === "read_item" && field === "window_id")
									? field
									: `${field}?`,
							).join(" "),
				]),
			),
			...(namespace === "notes"
				? {
						writes: gpt
							? "write_file=replace; append_to_file=add"
							: "write_file replaces; append_to_file adds",
						paths: gpt
							? "Relative=current agent; cross-agent=<agent>/notes[/path]"
							: "Relative uses current agent; cross-agent uses <agent>/notes[/path]",
						usage: '{ "action": "read_file", "path": "checkpoint" }',
						ranges: gpt
							? "start_line/stop_line=1-based inclusive; negative=from end; 0/null/omitted=first/last; out-of-range→clamp; reversed→empty"
							: "start_line/stop_line inclusive, 1-based; negative counts from end; 0/null/omitted uses first/last line; out-of-range clamps; reversed range returns empty content",
						defaults: gpt
							? "list max_results=20; search max_files/max_matches_per_file=20; limits clamp 1..100; list/search name ascending; recent_file_first→created_at descending"
							: "list max_results 20; search max_files/max_matches_per_file 20; limits clamp to 1..100; list name ascending; search name ascending, recent_file_first sorts created_at descending",
					}
				: {
						usage: gpt
							? "Earlierconversation→search≠browse; returned IDs unchanged"
							: "Search earlier conversation, don't browse it. Pass returned IDs unchanged",
						search: rankedHistory
							? gpt
								? "Own past user/assistant visible text: all keywords, case/accent-insensitive, BM25-ranked. Explicit live/tool/metadata/agent_name scopes→case-sensitive literal substring. list/read=full transcript; recent_first=true→newest first"
								: "Own earlier conversation: user/assistant visible text, all keywords, case/accent-insensitive, relevance order. Explicit live/tool/metadata scopes or agent_name: case-sensitive literal substring. list/read retain the full transcript. recent_first=true uses newest first"
							: gpt
								? "Case-sensitive literal substring; recent_first=true→newest first"
								: "Case-sensitive literal substring. recent_first=true uses newest first",
					}),
		});
	}
	return undefined;
}

export function prepareNotesArguments(args: unknown) {
	if (args === undefined) return {};
	if (!args || typeof args !== "object" || Array.isArray(args))
		throw new Error(
			'Supply an action object, e.g. { "action": "read_file", "path": "checkpoint" }. Use {} for help',
		);
	const params = { ...args } as Record<string, unknown>;
	if (params["action"] === "read") params["action"] = "read_file";
	if (
		(params["action"] === "write_file" ||
			params["action"] === "append_to_file") &&
		"content" in params
	) {
		if (!("text" in params)) params["text"] = params["content"];
		delete params["content"];
	}
	if (
		params["action"] === "list_files_by_prefix" &&
		params["max_files"] !== undefined
	) {
		if (!("max_results" in params)) params["max_results"] = params["max_files"];
		delete params["max_files"];
	}
	if (!queryHelp("notes", params)) queryArguments("notes", params);
	for (const [field, value] of Object.entries(params)) {
		const schema =
			NOTES_SCHEMA.properties[field as keyof typeof NOTES_SCHEMA.properties];
		if (!schema || !Check(schema, value))
			throw new Error(`Invalid notes ${field}; use {} for exact arguments`);
	}
	return params;
}
