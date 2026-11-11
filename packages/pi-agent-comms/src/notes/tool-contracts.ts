import type { AgentToolResult } from "@earendil-works/pi-coding-agent";
import {
	bool,
	compile,
	int,
	nul,
	obj,
	oneOf,
	opt,
	type Schema,
	str,
	union,
	type Validator,
} from "@earendil-works/pi-schema";
import type { LookupQuery } from "./bridge.js";
import { noteResult } from "./note-result.js";
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
export const NOTES_DESCRIPTION = "Virtual filesystem task checkpoints";
export const NOTES_ROUTING_GUIDELINE =
	"notes: task checkpoints and internal handoffs. MUST revise via write/append actions. Paths are virtual: read/write only through notes, never shell/filesystem tools. MUST NOT store project files or deliverables";
export const NEW_CONTEXT_DESCRIPTION =
	"Start fresh context window. MUST save notes before calling";
export const GPT_NEW_CONTEXT_DESCRIPTION = "Save notes→fresh context";
const STRING = opt(str());
const INTEGER = opt(int({ minimum: 1 }));
const LINE = opt(union([int(), nul()]));
export const NOTES_SCHEMA = obj(
	{
		action: opt({ ...oneOf(NOTES_ACTIONS), type: "string" }),
		path: opt(
			union([str(), nul()], {
				description:
					"File for read/write/append; prefix for list/search; virtual filesystem, not files in the project",
			}),
		),
		text: STRING,
		query: STRING,
		start_line: LINE,
		stop_line: LINE,
		limit: INTEGER,
		max_matches_per_file: INTEGER,
		file_order: opt({ ...oneOf(["ascending", "descending"]), type: "string" }),
		file_order_by: opt({
			...oneOf(["name", "created_at", "updated_at"]),
			type: "string",
		}),
		recent_file_first: opt(bool()),
	},
	{ open: false },
);
const NEW_CONTEXT_SCHEMA = obj(
	{
		role: opt(
			str({
				minLength: 1,
				description:
					"Configured model-role ID, not an agent name or handoff text",
			}),
		),
	},
	{ open: false },
);

const newContextSchemaValidator = compile(NEW_CONTEXT_SCHEMA);

export function newContextSchema(roleIds: string[]) {
	return obj(
		roleIds.length ? { role: opt({ ...oneOf(roleIds), type: "string" }) } : {},
		{ open: false },
	);
}

export function prepareNewContextArguments(input: unknown) {
	const args = input ?? {};
	if (!newContextSchemaValidator.check(args))
		throw new Error(
			'Use {} to keep the current model, or {role: "name"} for a configured role.',
		);
	return args;
}
export const HISTORY_SCHEMA = obj(
	{
		action: opt({ ...oneOf(HISTORY_ACTIONS), type: "string" }),
		agent_name: opt(union([str(), nul()])),
		item_id: opt(str()),
		window_id: opt(
			union([str(), nul()], {
				description: "Required with item_id for read",
			}),
		),
		query: STRING,
		limit: INTEGER,
		limit_chars: INTEGER,
		max_chars_per_item: INTEGER,
		offset_chars: opt(int({ minimum: 0 })),
		recent_first: opt(bool()),
		role: opt(
			union([
				{
					...oneOf(["user", "assistant", "tool", "system", "developer"]),
					type: "string",
				},
				nul(),
			]),
		),
		tool_name: opt(union([str(), nul()])),
		tool_namespace: opt(union([str(), nul()])),
	},
	{ open: false },
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
		return (namespace === "notes" ? noteResult : result)({
			...(namespace === "notes"
				? { results: "read: file.content; write/append: file.path" }
				: {}),
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
							? "Virtual≠disk; own list/search→omit path; relative=current agent; absolute=/<session ID>/notes[/path], not the agent ID alone"
							: "Virtual note paths, not disk files. Omit path to list/search your notes. Relative paths use your agent; absolute paths require /<session ID>/notes[/path], not the agent ID alone",
						usage: 'notes: {"action":"read","path":"checkpoint"}',
						ranges: gpt
							? "start_line/stop_line=1-based inclusive; negative=from end; 0/null/omitted=first/last; out-of-range→clamp; reversed→empty"
							: "start_line/stop_line inclusive, 1-based; negative from end; 0/null/omitted uses first/last line; out-of-range clamps; reversed returns empty content",
						defaults: gpt
							? "list limit=20; search limit/max_matches_per_file=20; limits clamp 1..100; list/search name ascending; recent_file_first→created_at descending"
							: "list limit 20; search limit/max_matches_per_file 20; limits clamp 1..100; list/search name ascending; recent_file_first sorts created_at descending",
					}
				: {
						usage: gpt
							? "query→search default; past chat→search≠browse; returned IDs unchanged"
							: "With query, action defaults to search. Search past chat, don't browse it. Pass returned IDs unchanged",
						search: gpt
							? "recent_first=true→newest first"
							: "recent_first=true uses newest first",
					}),
		});
	}
	return undefined;
}

export function prepareNotesArguments(args: unknown) {
	const params = normalizeQueryInput("notes", args);
	validateArguments("notes", params, NOTES_FIELD_VALIDATORS);
	return params;
}

export function prepareHistoryArguments(args: unknown) {
	const params = normalizeQueryInput("history", args);
	validateArguments("history", params, HISTORY_FIELD_VALIDATORS);
	return params;
}

const NOTES_FIELD_VALIDATORS = fieldValidators(NOTES_SCHEMA);
const HISTORY_FIELD_VALIDATORS = fieldValidators(HISTORY_SCHEMA);

function fieldValidators(schema: Schema): Record<string, Validator> {
	return Object.fromEntries(
		Object.entries(schema["properties"] as Record<string, Schema>).map(
			([field, property]) => [field, compile(property)],
		),
	);
}

function validateArguments(
	namespace: LookupQuery["namespace"],
	params: Record<string, unknown>,
	validators: Record<string, Validator>,
) {
	if (!queryHelp(namespace, params)) queryArguments(namespace, params);
	for (const [field, value] of Object.entries(params)) {
		const validator = validators[field];
		if (!validator || !validator.check(value))
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
