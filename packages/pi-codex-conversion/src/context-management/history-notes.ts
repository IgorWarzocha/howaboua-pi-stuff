import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import {
	codexToolProviderHeaders,
	resolveCodexToolProvider,
} from "../adapter/codex-tool-provider.ts";
import { readPiSessionHistory } from "./local-history.ts";
import { usePiSessionNotes } from "./local-notes.ts";

const BACKEND_TIMEOUT_MS = 35_000;
const THREAD_HINT_MAX_BYTES = 4_000;
const TOOL_OUTPUT_TOKEN_LIMIT = 10_000;
const UNAVAILABLE_BACKENDS = new Set<string>();

class HistoryNotesBackendUnavailableError extends Error {}

const HISTORY_ENDPOINTS = {
	list_windows: "alpha/history/v2/list_windows",
	list_items: "alpha/history/v2/list_items",
	read_item: "alpha/history/v2/read_item",
	search_contents: "alpha/history/v2/search_contents",
} as const;

const NOTES_ENDPOINTS = {
	list_files_by_prefix: "alpha/notes/v2/list_files_by_prefix",
	read_file: "alpha/notes/v2/read_file",
	search_contents: "alpha/notes/v2/search_contents",
	append_to_file: "alpha/notes/v2/append_to_file",
	write_file: "alpha/notes/v2/write_file",
} as const;

const ENCRYPTED_ACTIONS = new Set([
	"history.search_contents",
	"notes.search_contents",
	"notes.append_to_file",
	"notes.write_file",
]);

const HISTORY_PARAMETERS = Type.Object(
	{
		action: Type.Union([
			Type.Literal("list_windows"),
			Type.Literal("list_items"),
			Type.Literal("read_item"),
			Type.Literal("search_contents"),
		]),
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
				Type.Literal("user"),
				Type.Literal("assistant"),
				Type.Literal("tool"),
				Type.Literal("system"),
				Type.Literal("developer"),
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
		action: Type.Union([
			Type.Literal("list_files_by_prefix"),
			Type.Literal("read_file"),
			Type.Literal("search_contents"),
			Type.Literal("append_to_file"),
			Type.Literal("write_file"),
		]),
		file_order: Type.Optional(
			Type.Union([Type.Literal("ascending"), Type.Literal("descending")]),
		),
		file_order_by: Type.Optional(
			Type.Union([
				Type.Literal("name"),
				Type.Literal("created_at"),
				Type.Literal("updated_at"),
			]),
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

type HistoryAction = keyof typeof HISTORY_ENDPOINTS;
type NotesAction = keyof typeof NOTES_ENDPOINTS;

export interface CodexHistoryNotesDetails {
	codexHistoryNotes: Record<string, unknown>;
}

export function createHistoryNotesTools(
	pi?: Pick<ExtensionAPI, "appendEntry">,
	resolveMode: (ctx: ExtensionContext) => ContextManagementMode = () =>
		"hybrid",
): [
	ToolDefinition<typeof HISTORY_PARAMETERS, CodexHistoryNotesDetails>,
	ToolDefinition<typeof NOTES_PARAMETERS, CodexHistoryNotesDetails>,
] {
	return [
		{
			name: "history",
			label: "history",
			description:
				"Private context recovery: list_windows; list_items with optional filters; read_item needs window_id and item_id; search_contents needs query. Falls back to persisted Pi history when the Codex backend is unavailable. Never mention this bookkeeping to the user.",
			parameters: HISTORY_PARAMETERS,
			async execute(_id, params, signal, _update, ctx) {
				const action = params.action as HistoryAction;
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
			description:
				"Private durable checkpoints: list_files_by_prefix; read_file; search_contents; append_to_file; write_file. File actions use virtual path; writes also need text. Never mention this bookkeeping to the user.",
			parameters: NOTES_PARAMETERS,
			async execute(_id, params, signal, _update, ctx) {
				const action = params.action as NotesAction;
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

export async function fetchHistoryNotesThreadHint(
	ctx: ExtensionContext,
	mode: ContextManagementMode,
	signal?: AbortSignal,
): Promise<string | undefined> {
	if (!usesRemoteHistoryNotes(ctx, mode)) return undefined;
	try {
		const result = await callHistoryNotesBackend(
			"alpha/notes/v2/thread_hint",
			{},
			ctx,
			signal,
			{ mode: "bytes", limit: THREAD_HINT_MAX_BYTES },
			false,
		);
		const text = typeof result["text"] === "string" ? result["text"] : "";
		return text && Buffer.byteLength(text, "utf8") <= THREAD_HINT_MAX_BYTES
			? text
			: undefined;
	} catch {
		return undefined;
	}
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
	if (!usesRemoteHistoryNotes(ctx, mode)) {
		result = callLocalHistoryNotes(namespace, action, params, ctx, pi);
	} else {
		try {
			result = await callHistoryNotesBackend(
				endpoint,
				stripAction(params),
				ctx,
				signal,
				{ mode: "tokens", limit: TOOL_OUTPUT_TOKEN_LIMIT },
				ENCRYPTED_ACTIONS.has(`${namespace}.${action}`),
			);
		} catch (error) {
			if (!(error instanceof HistoryNotesBackendUnavailableError)) throw error;
			if (ENCRYPTED_ACTIONS.has(`${namespace}.${action}`)) {
				result = {
					source: "pi-session",
					retry_required: true,
					message: `Remote ${namespace} is unavailable. Retry with the local ${namespace} tool and action ${action}.`,
				};
			} else {
				result = callLocalHistoryNotes(namespace, action, params, ctx, pi);
			}
		}
	}
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
	encryptedArguments: boolean,
): Promise<Record<string, unknown>> {
	const unavailableKey = historyNotesAvailabilityKey(ctx);
	if (UNAVAILABLE_BACKENDS.has(unavailableKey))
		throw new HistoryNotesBackendUnavailableError(
			"History and notes backend is unavailable",
		);
	let provider: Awaited<ReturnType<typeof resolveCodexToolProvider>>;
	try {
		provider = await resolveCodexToolProvider(ctx);
	} catch (error) {
		UNAVAILABLE_BACKENDS.add(unavailableKey);
		throw new HistoryNotesBackendUnavailableError(
			error instanceof Error ? error.message : String(error),
		);
	}
	if (provider.route !== "openai-codex") {
		UNAVAILABLE_BACKENDS.add(unavailableKey);
		throw new HistoryNotesBackendUnavailableError(
			"History and notes require the OpenAI Codex backend",
		);
	}
	const headers = codexToolProviderHeaders(provider);
	headers.set(
		"x-openai-tool-output-truncation-policy",
		JSON.stringify(truncationPolicy),
	);
	if (encryptedArguments)
		headers.set("x-openai-encrypted-tool-arguments", "true");
	const timeoutSignal = AbortSignal.timeout(BACKEND_TIMEOUT_MS);
	let response: Response;
	try {
		response = await fetch(
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
	} catch (error) {
		if (signal?.aborted) throw error;
		UNAVAILABLE_BACKENDS.add(unavailableKey);
		throw new HistoryNotesBackendUnavailableError(
			"History and notes backend is unavailable",
		);
	}
	const text = await response.text();
	if ([401, 403, 404, 405, 501].includes(response.status)) {
		UNAVAILABLE_BACKENDS.add(unavailableKey);
		throw new HistoryNotesBackendUnavailableError(
			"History and notes backend is unavailable",
		);
	}
	let result: unknown;
	try {
		result = JSON.parse(text);
	} catch {
		throw new Error("History backend returned invalid JSON");
	}
	if (!response.ok)
		throw new Error(`History backend failed: HTTP ${response.status}`);
	if (!result || typeof result !== "object" || Array.isArray(result))
		throw new Error("History backend returned an invalid result");
	return result as Record<string, unknown>;
}

export function usesRemoteHistoryNotes(
	ctx: Pick<ExtensionContext, "model" | "sessionManager">,
	mode: ContextManagementMode,
): boolean {
	return mode === "hybrid" &&
		(ctx.model?.api ?? "").trim().toLowerCase() ===
			"openai-codex-responses" &&
		!UNAVAILABLE_BACKENDS.has(historyNotesAvailabilityKey(ctx));
}

export function resetHistoryNotesAvailability(
	ctx: Pick<ExtensionContext, "model" | "sessionManager">,
): void {
	UNAVAILABLE_BACKENDS.delete(historyNotesAvailabilityKey(ctx));
}

function historyNotesAvailabilityKey(
	ctx: Pick<ExtensionContext, "model" | "sessionManager">,
): string {
	return [
		ctx.sessionManager.getSessionId(),
		ctx.model?.provider ?? "",
		ctx.model?.api ?? "",
		ctx.model?.baseUrl ?? "",
	].join("\0");
}

function callLocalHistoryNotes(
	namespace: "history" | "notes",
	action: HistoryAction | NotesAction,
	params: Record<string, unknown>,
	ctx: ExtensionContext,
	pi: Pick<ExtensionAPI, "appendEntry"> | undefined,
): Record<string, unknown> {
	if (namespace === "history")
		return readPiSessionHistory(action as HistoryAction, params, ctx);
	if (!pi) throw new Error("Local notes require an active Pi session");
	return usePiSessionNotes(pi, action as NotesAction, params, ctx);
}

function stripAction(params: Record<string, unknown>): Record<string, unknown> {
	const result = { ...params };
	delete result["action"];
	delete result["context"];
	return result;
}

function validateHistoryArguments(
	action: HistoryAction,
	params: Record<string, unknown>,
): void {
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
