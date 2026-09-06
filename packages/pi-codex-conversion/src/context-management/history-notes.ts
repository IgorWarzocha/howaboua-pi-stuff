import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { historyNotesRenderers } from "./rendering.ts";
import {
	codexToolProviderHeaders,
	resolveCodexToolProvider,
} from "../adapter/codex-tool-provider.ts";
import {
	getPiSessionHistoryRecoveryHint,
	readPiSessionHistory,
} from "./local-history.ts";
import {
	renderPiSessionNotesThreadHint,
	usePiSessionNotes,
} from "./local-notes.ts";
import {
	HISTORY_ACTIONS,
	HISTORY_DESCRIPTION,
	type HistoryAction,
	NOTES_ACTIONS,
	NOTES_DESCRIPTION,
	type NotesAction,
} from "./tool-contract.ts";

const BACKEND_TIMEOUT_MS = 35_000;
const THREAD_HINT_MAX_BYTES = 4_000;
const TOOL_OUTPUT_TOKEN_LIMIT = 10_000;

const HISTORY_ENDPOINTS = {
	list_windows: "alpha/history/v2/list_windows",
	list_items: "alpha/history/v2/list_items",
	read_item: "alpha/history/v2/read_item",
	search_contents: "alpha/history/v2/search_contents",
} as const satisfies Record<HistoryAction, string>;

const NOTES_ENDPOINTS = {
	list_files_by_prefix: "alpha/notes/v2/list_files_by_prefix",
	read_file: "alpha/notes/v2/read_file",
	search_contents: "alpha/notes/v2/search_contents",
	append_to_file: "alpha/notes/v2/append_to_file",
	write_file: "alpha/notes/v2/write_file",
} as const satisfies Record<NotesAction, string>;

const ENCRYPTED_ARGUMENT_ENDPOINTS = new Set<string>([
	HISTORY_ENDPOINTS.search_contents,
	NOTES_ENDPOINTS.search_contents,
	NOTES_ENDPOINTS.append_to_file,
	NOTES_ENDPOINTS.write_file,
]);

const HISTORY_ACTION_SET = new Set<string>(HISTORY_ACTIONS);
const NOTES_ACTION_SET = new Set<string>(NOTES_ACTIONS);

const HISTORY_ACTION_FIELDS = {
	list_windows: ["agent_name", "limit", "recent_first"],
	list_items: [
		"agent_name",
		"limit",
		"max_chars_per_item",
		"recent_first",
		"role",
		"tool_name",
		"tool_namespace",
		"window_id",
	],
	read_item: [
		"agent_name",
		"item_id",
		"limit_chars",
		"offset_chars",
		"window_id",
	],
	search_contents: [
		"agent_name",
		"limit",
		"query",
		"recent_first",
		"role",
		"tool_name",
		"tool_namespace",
		"window_id",
	],
} satisfies Record<HistoryAction, readonly string[]>;

const NOTES_ACTION_FIELDS = {
	list_files_by_prefix: ["file_order", "file_order_by", "max_results", "prefix"],
	read_file: ["path", "start_line", "stop_line"],
	search_contents: [
		"max_files",
		"max_matches_per_file",
		"path_prefix",
		"query",
		"recent_file_first",
	],
	append_to_file: ["path", "text"],
	write_file: ["path", "text"],
} satisfies Record<NotesAction, readonly string[]>;

const HISTORY_PARAMETERS = Type.Object(
	{
		action: StringEnum(HISTORY_ACTIONS),
		agent_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		item_id: Type.Optional(Type.String()),
		limit: Type.Optional(Type.Integer({ minimum: 1 })),
		limit_chars: Type.Optional(Type.Integer({ minimum: 1 })),
		max_chars_per_item: Type.Optional(Type.Integer({ minimum: 1 })),
		offset_chars: Type.Optional(Type.Integer({ minimum: 0 })),
		query: Type.Optional(Type.String()),
		recent_first: Type.Optional(Type.Boolean()),
		role: Type.Optional(
			Type.Union([
				StringEnum([
					"user",
					"assistant",
					"tool",
					"system",
					"developer",
				] as const),
				Type.Null(),
			]),
		),
		tool_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		tool_namespace: Type.Optional(
			Type.Union([Type.String(), Type.Null()]),
		),
		window_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
	},
	{ additionalProperties: false },
);

const NOTES_PARAMETERS = Type.Object(
	{
		action: StringEnum(NOTES_ACTIONS),
		file_order: Type.Optional(
			StringEnum(["ascending", "descending"] as const),
		),
		file_order_by: Type.Optional(
			StringEnum(["name", "created_at", "updated_at"] as const),
		),
		max_files: Type.Optional(Type.Integer({ minimum: 1 })),
		max_matches_per_file: Type.Optional(Type.Integer({ minimum: 1 })),
		max_results: Type.Optional(Type.Integer({ minimum: 1 })),
		path: Type.Optional(Type.String()),
		path_prefix: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		prefix: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		query: Type.Optional(Type.String()),
		recent_file_first: Type.Optional(Type.Boolean()),
		start_line: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
		stop_line: Type.Optional(Type.Union([Type.Integer(), Type.Null()])),
		text: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);

export interface CodexHistoryNotesDetails {
	codexHistoryNotes: Record<string, unknown>;
}

export function createHistoryNotesTools(
	pi?: Pick<ExtensionAPI, "appendEntry">,
	resolveMode: (ctx: ExtensionContext) => ContextManagementMode = () =>
		"local",
): [
	ToolDefinition<typeof HISTORY_PARAMETERS, CodexHistoryNotesDetails>,
	ToolDefinition<typeof NOTES_PARAMETERS, CodexHistoryNotesDetails>,
] {
	return [
		{
			name: "history",
			label: "history",
			description: HISTORY_DESCRIPTION,
			parameters: HISTORY_PARAMETERS,
			...historyNotesRenderers("history"),
			async execute(_id, params, signal, _update, ctx) {
				const action = historyAction(params.action);
				validateHistoryArguments(action, params);
				return callHistoryNotesTool(
					"history",
					action,
					HISTORY_ENDPOINTS[action],
					params,
					ctx,
					signal,
					resolveMode(ctx),
					pi,
				);
			},
		},
		{
			name: "notes",
			label: "notes",
			description: NOTES_DESCRIPTION,
			parameters: NOTES_PARAMETERS,
			...historyNotesRenderers("notes"),
			executionMode: "sequential",
			async execute(_id, params, signal, _update, ctx) {
				const action = notesAction(params.action);
				validateNotesArguments(action, params);
				return callHistoryNotesTool(
					"notes",
					action,
					NOTES_ENDPOINTS[action],
					params,
					ctx,
					signal,
					resolveMode(ctx),
					pi,
				);
			},
		},
	];
}

export async function loadHistoryNotesThreadHint(
	ctx: ExtensionContext,
	mode: ContextManagementMode,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (mode === "local" || mode === "tree")
		return piSessionThreadHint(ctx, mode);
	if (!usesRemoteHistoryNotes(ctx, mode)) return undefined;
	try {
		const result = await callHistoryNotesBackend(
			"alpha/notes/v2/thread_hint",
			{},
			ctx,
			signal,
			{ mode: "bytes", limit: THREAD_HINT_MAX_BYTES },
		);
		const text = typeof result["text"] === "string" ? result["text"] : "";
		return text && Buffer.byteLength(text, "utf8") <= THREAD_HINT_MAX_BYTES
			? text
			: undefined;
	} catch (error) {
		if (signal?.aborted) throw error;
		return undefined;
	}
}

function piSessionThreadHint(
	ctx: ExtensionContext,
	mode: ContextManagementMode,
): string | undefined {
	const recovery = getPiSessionHistoryRecoveryHint(ctx, mode);
	const recoveryHint = recovery
		? `Previous window history IDs: ${JSON.stringify(recovery)}`
		: undefined;
	const recoveryBytes = recoveryHint
		? Buffer.byteLength(`\n${recoveryHint}`, "utf8")
		: 0;
	const notesHint = renderPiSessionNotesThreadHint(
		ctx.sessionManager.getBranch(),
		Math.max(0, THREAD_HINT_MAX_BYTES - recoveryBytes),
	);
	const hint = [notesHint, recoveryHint].filter(
		(value): value is string => Boolean(value),
	).join("\n");
	return hint && Buffer.byteLength(hint, "utf8") <= THREAD_HINT_MAX_BYTES
		? hint
		: undefined;
}

async function callHistoryNotesTool(
	namespace: "history" | "notes",
	action: HistoryAction | NotesAction,
	endpoint: string,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	mode: ContextManagementMode,
	pi: Pick<ExtensionAPI, "appendEntry"> | undefined,
): Promise<AgentToolResult<CodexHistoryNotesDetails>> {
	let result: Record<string, unknown>;
	if (mode === "remote") {
		if (!usesRemoteHistoryNotes(ctx, mode))
			throw new Error("Remote history and notes require Codex transport");
		result = await callHistoryNotesBackend(
			endpoint,
			stripAction(params),
			ctx,
			signal,
			{ mode: "tokens", limit: TOOL_OUTPUT_TOKEN_LIMIT },
		);
	} else result = callLocalHistoryNotes(namespace, action, params, ctx, pi, mode);
	const modelResult = { ...result };
	delete modelResult["images"];
	const content: AgentToolResult<CodexHistoryNotesDetails>["content"] = [
		{
			type: "text",
			text:
				typeof modelResult["encrypted_output"] === "string"
					? `${namespace} operation completed`
					: JSON.stringify(modelResult),
		},
	];
	for (const image of parseBackendImages(result["images"])) content.push(image);
	return {
		content,
		details: { codexHistoryNotes: modelResult },
	};
}

async function callHistoryNotesBackend(
	endpoint: string,
	arguments_: Record<string, unknown>,
	ctx: ExtensionContext,
	signal: AbortSignal | undefined,
	truncationPolicy: { mode: "bytes" | "tokens"; limit: number },
): Promise<Record<string, unknown>> {
	const provider = await resolveCodexToolProvider(ctx);
	if (provider.route !== "openai-codex")
		throw new Error("History and notes require the OpenAI Codex backend");
	const headers = codexToolProviderHeaders(provider);
	headers.set(
		"x-openai-tool-output-truncation-policy",
		JSON.stringify(truncationPolicy),
	);
	if (ENCRYPTED_ARGUMENT_ENDPOINTS.has(endpoint))
		headers.set("x-openai-encrypted-tool-arguments", "true");
	const timeoutSignal = AbortSignal.timeout(BACKEND_TIMEOUT_MS);
	const response = await fetch(
		`${provider.baseUrl.replace(/\/+$/, "")}/${endpoint}`,
		{
			method: "POST",
			headers,
			signal: signal
				? AbortSignal.any([signal, timeoutSignal])
				: timeoutSignal,
			body: JSON.stringify({
				...arguments_,
				context: {
					session_id: ctx.sessionManager.getSessionId(),
					current_agent_name: "/root",
				},
			}),
		},
	);
	if (!response.ok)
		throw new Error(`History and notes backend failed (${response.status})`);
	const result: unknown = JSON.parse(await response.text());
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("History and notes backend returned invalid data");
	return result as Record<string, unknown>;
}

export function usesRemoteHistoryNotes(
	ctx: Pick<ExtensionContext, "model" | "sessionManager">,
	mode: ContextManagementMode,
): boolean {
	return mode === "remote" &&
		(ctx.model?.api ?? "").trim().toLowerCase() ===
			"openai-codex-responses";
}

function callLocalHistoryNotes(
	namespace: "history" | "notes",
	action: HistoryAction | NotesAction,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	pi: Pick<ExtensionAPI, "appendEntry"> | undefined,
	mode: ContextManagementMode,
): Record<string, unknown> {
	if (namespace === "history")
		return readPiSessionHistory(action as HistoryAction, params, ctx, mode);
	if (!pi) throw new Error("Local notes require an active Pi session");
	return usePiSessionNotes(pi, action as NotesAction, params, ctx);
}

function stripAction(params: Record<string, unknown>): Record<string, unknown> {
	const result = { ...params };
	delete result["action"];
	delete result["context"];
	return result;
}

function historyAction(value: unknown): HistoryAction {
	if (typeof value === "string" && HISTORY_ACTION_SET.has(value))
		return value as HistoryAction;
	throw new Error("history requires a supported action");
}

function notesAction(value: unknown): NotesAction {
	if (typeof value === "string" && NOTES_ACTION_SET.has(value))
		return value as NotesAction;
	throw new Error("notes requires a supported action");
}

function validateActionFields(
	namespace: "history" | "notes",
	action: HistoryAction | NotesAction,
	params: Record<string, unknown>,
	allowed: readonly string[],
): void {
	const unexpected = Object.keys(params).find(
		(field) => field !== "action" && !allowed.includes(field),
	);
	if (unexpected)
		throw new Error(`${namespace} ${action} does not accept ${unexpected}`);
}

function validateHistoryArguments(
	action: HistoryAction,
	params: Record<string, unknown>,
): void {
	validateActionFields("history", action, params, HISTORY_ACTION_FIELDS[action]);
	if (action === "read_item") {
		if (typeof params["item_id"] !== "string" || !params["item_id"])
			throw new Error("history read_item requires item_id");
		if (typeof params["window_id"] !== "string" || !params["window_id"])
			throw new Error("history read_item requires window_id");
	}
	if (
		action === "search_contents" &&
		(typeof params["query"] !== "string" || !params["query"])
	)
		throw new Error("history search_contents requires query");
}

function validateNotesArguments(
	action: NotesAction,
	params: Record<string, unknown>,
): void {
	validateActionFields("notes", action, params, NOTES_ACTION_FIELDS[action]);
	if (
		(action === "read_file" ||
			action === "append_to_file" ||
			action === "write_file") &&
		(typeof params["path"] !== "string" || !params["path"])
	)
		throw new Error(`notes ${action} requires path`);
	if (
		(action === "search_contents" &&
			(typeof params["query"] !== "string" || !params["query"])) ||
		((action === "append_to_file" || action === "write_file") &&
			typeof params["text"] !== "string")
	)
		throw new Error(
			`notes ${action} requires ${action === "search_contents" ? "query" : "text"}`,
		);
}

function parseBackendImages(
	value: unknown,
): Array<{
	type: "image";
	data: string;
	mimeType: string;
	detail?: "auto" | "high" | "original" | undefined;
}> {
	if (value === undefined) return [];
	if (!Array.isArray(value))
		throw new Error("History backend returned invalid image content");
	return value.map((item) => {
		if (!item || typeof item !== "object")
			throw new Error("History backend returned invalid image content");
		const image = item as Record<string, unknown>;
		if (
			typeof image["data"] !== "string" ||
			typeof image["mime_type"] !== "string"
		)
			throw new Error("History backend returned invalid image content");
		const detail = image["detail"];
		if (
			detail !== undefined &&
			detail !== null &&
			detail !== "auto" &&
			detail !== "high" &&
			detail !== "original"
		)
			throw new Error("History backend returned invalid image detail");
		return {
			type: "image" as const,
			data: image["data"],
			mimeType: image["mime_type"],
			...(detail ? { detail } : {}),
		};
	});
}
