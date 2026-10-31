import { StringEnum } from "@earendil-works/pi-ai";
import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { Check } from "typebox/value";
import type { LookupQuery } from "./bridge.js";
import { internalQueryArguments, normalizeQueryInput } from "./query-input.js";

const NOTES_ACTIONS = [
	"help",
	"list",
	"read",
	"search",
	"append",
	"write",
] as const;
const HISTORY_ACTIONS = [
	"help",
	"list_windows",
	"list",
	"read",
	"search",
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
const LINE = Type.Optional(Type.Union([Type.Integer(), Type.Null()]));
export const NOTES_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum(NOTES_ACTIONS)),
		path: Type.Optional(
			Type.Union([Type.String(), Type.Null()], {
				description: "File for read/write/append; prefix for list/search",
			}),
		),
		text: STRING,
		query: STRING,
		start_line: LINE,
		stop_line: LINE,
		limit: INTEGER,
		max_matches_per_file: INTEGER,
		file_order: Type.Optional(StringEnum(["ascending", "descending"])),
		file_order_by: Type.Optional(
			StringEnum(["name", "created_at", "updated_at"]),
		),
		recent_file_first: Type.Optional(Type.Boolean()),
	},
	{ additionalProperties: false },
);
export const NEW_CONTEXT_SCHEMA = Type.Object(
	{ role: Type.Optional(Type.String({ minLength: 1 })) },
	{ additionalProperties: false },
);

export function prepareNewContextArguments(input: unknown) {
	const args = input ?? {};
	if (!Check(NEW_CONTEXT_SCHEMA, args))
		throw new Error(
			'Use {} to keep the current model, or {role: "name"} for a configured role.',
		);
	return args;
}
export const HISTORY_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum(HISTORY_ACTIONS)),
		agent_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		item_id: STRING,
		window_id: Type.Optional(
			Type.Union([Type.String(), Type.Null()], {
				description: "Required with item_id for read",
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
	const normalized = normalizeQueryInput(namespace, input);
	const params = internalQueryArguments(namespace, normalized);
	const action = params["action"];
	const publicAction = normalized["action"];
	const key =
		action === "search_contents" ? `search_${namespace}` : String(action);
	const fields = FIELDS[key];
	if (!fields)
		throw new Error(
			namespace === "notes"
				? "notes requires a supported action"
				: "Unknown action",
		);
	for (const field of Object.keys(params))
		if (field !== "action" && !fields.includes(field))
			throw new Error(
				`${namespace} ${String(publicAction)} does not accept ${field}; use {} for help`,
			);
	if (
		["read_file", "write_file", "append_to_file"].includes(String(action)) &&
		(typeof params["path"] !== "string" || !params["path"])
	)
		throw new Error(`notes ${String(publicAction)} requires path`);
	if (
		action === "search_contents" &&
		(typeof params["query"] !== "string" || !params["query"])
	)
		throw new Error(`${namespace} search requires query`);
	if (
		["write_file", "append_to_file"].includes(String(action)) &&
		typeof params["text"] !== "string"
	)
		throw new Error(`notes ${String(publicAction)} requires text`);
	return params;
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
						: FIELDS[helpKey(namespace, action)]!.map((field) =>
								["path", "text", "query", "item_id"].includes(field) ||
								(action === "read" && field === "window_id")
									? field
									: `${field}?`,
							)
								.map((field) => publicField(namespace, field))
								.join(" "),
				]),
			),
			...(namespace === "notes"
				? {
						writes: gpt
							? "write=replace; append=add"
							: "write replaces; append adds",
						paths: gpt
							? "Relative=current agent; cross-agent=<agent>/notes[/path]"
							: "Relative uses current agent; cross-agent uses <agent>/notes[/path]",
						usage: '{ "action": "read", "path": "checkpoint" }',
						ranges: gpt
							? "start_line/stop_line=1-based inclusive; negative=from end; 0/null/omitted=first/last; out-of-range→clamp; reversed→empty"
							: "start_line/stop_line inclusive, 1-based; negative counts from end; 0/null/omitted uses first/last line; out-of-range clamps; reversed range returns empty content",
						defaults: gpt
							? "list limit=20; search limit/max_matches_per_file=20; limits clamp 1..100; list/search name ascending; recent_file_first→created_at descending"
							: "list limit 20; search limit/max_matches_per_file 20; limits clamp to 1..100; list name ascending; search name ascending, recent_file_first sorts created_at descending",
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
	const params = normalizeQueryInput("notes", args);
	validateArguments("notes", params, NOTES_SCHEMA);
	return params;
}

export function prepareHistoryArguments(args: unknown) {
	const params = normalizeQueryInput("history", args);
	validateArguments("history", params, HISTORY_SCHEMA);
	return params;
}

function validateArguments(
	namespace: LookupQuery["namespace"],
	params: Record<string, unknown>,
	schema: import("typebox").TObject,
) {
	if (!queryHelp(namespace, params)) queryArguments(namespace, params);
	for (const [field, value] of Object.entries(params)) {
		const property = schema.properties[field];
		if (!property || !Check(property, value))
			throw new Error(
				`Invalid ${namespace} ${field}; use {} for exact arguments`,
			);
	}
}

function helpKey(namespace: LookupQuery["namespace"], action: string) {
	const internal = internalQueryArguments(namespace, { action })["action"];
	return internal === "search_contents"
		? `search_${namespace}`
		: String(internal);
}

function publicField(namespace: LookupQuery["namespace"], field: string) {
	if (namespace !== "notes") return field;
	return field
		.replace(/^(prefix|path_prefix)(\?)?$/, "path$2")
		.replace(/^(max_results|max_files)(\?)?$/, "limit$2");
}
