import { StringEnum } from "@earendil-works/pi-ai";
import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type {
	CachedResponse,
	LookupQuery,
	SerializedCachedResponse,
	SharedNotesDetails,
} from "./bridge.js";
import { queryKey } from "./bridge.js";
import { useHistory } from "./history.js";
import type { NotesLifecycle } from "./lifecycle.js";
import {
	CACHE_RECEIPT,
	collectNotes,
	normalizeNoteParams,
	sessionRef,
	sourceSessionIds,
	useNotes,
} from "./notes.js";
import type { NotesStore } from "./store.js";

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
export const NOTES_USAGE = "await tools.notes() // help";
export const HISTORY_USAGE = "await tools.history() // help";
const STRING = Type.Optional(Type.String());
const INTEGER = Type.Optional(Type.Integer({ minimum: 1 }));
const NOTES_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum(NOTES_ACTIONS)),
		path: STRING,
		text: STRING,
		prefix: STRING,
		query: STRING,
		path_prefix: STRING,
		start_line: INTEGER,
		stop_line: INTEGER,
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
const HISTORY_SCHEMA = Type.Object(
	{
		action: Type.Optional(StringEnum(HISTORY_ACTIONS)),
		agent_name: Type.Optional(Type.Union([Type.String(), Type.Null()])),
		item_id: STRING,
		window_id: Type.Optional(Type.Union([Type.String(), Type.Null()])),
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
function relevant(
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
	if (!fields) throw new Error("Unknown action");
	return Object.fromEntries(
		Object.entries(params).filter(
			([key]) => key === "action" || fields.includes(key),
		),
	);
}

function result(payload: unknown): AgentToolResult<unknown> {
	return {
		content: [{ type: "text", text: JSON.stringify(payload) }],
		details: {},
	};
}

function discovery(
	namespace: LookupQuery["namespace"],
	input: unknown,
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
		});
	}
	return undefined;
}

async function hybrid(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	query: LookupQuery,
	local: Record<string, unknown>,
	callId: string,
	ctx: ExtensionContext,
	signal?: AbortSignal,
	shared = false,
): Promise<AgentToolResult<unknown>> {
	let responses: readonly CachedResponse[] = store.cached(
		sourceSessionIds(ctx),
		query,
	);
	let state = responses.length ? "cache" : "unavailable";
	let lookupFailed = false;
	const bridge = lifecycle.bridge;
	if (bridge?.lookup) {
		let fetched: readonly CachedResponse[] | undefined;
		try {
			fetched = await bridge.lookup(query, ctx, signal);
		} catch (error) {
			if (signal?.aborted) throw error;
			lookupFailed = true;
		}
		if (signal?.aborted) throw new Error("Lookup cancelled");
		if (fetched) {
			try {
				store.cache(sessionRef(ctx), fetched);
			} catch {
				throw new Error(
					"Remote results could not be retained locally. Retry this lookup when local storage is available.",
				);
			}
			if (fetched.length)
				pi.appendEntry(CACHE_RECEIPT, {
					protocol: 1,
					sessionId: ctx.sessionManager.getSessionId(),
				});
			const exact = fetched.filter(
				(response) => queryKey(response.query) === queryKey(query),
			);
			if (exact.length) {
				responses = exact;
				state = "live";
			}
		}
	}
	const canProject =
		shared ||
		(Boolean(bridge?.projectResult) && bridge?.canProject?.(ctx) !== false);
	if (responses.length && !canProject) state = "incompatible";
	const remote = {
		state,
		...(lookupFailed
			? {
					lookup: "failed",
					recovery: "Retry this lookup when remote access is available",
				}
			: {}),
		coverage: responses.length
			? responses.map((response) => ({
					source: response.source,
					fetched_at: response.fetchedAt,
					coverage: response.coverage,
				}))
			: "No cached response for this exact query",
		...(state === "cache"
			? { scope: "Exact cached query only, not a complete offline archive" }
			: {}),
		...(state === "incompatible"
			? {
					recovery:
						"Cached encrypted contents are unavailable on this model. Local notes remain available",
				}
			: {}),
	};
	const output = result({ source: "local", local, remote });
	if (shared)
		return {
			...output,
			details: {
				codexHistoryNotes: {},
				externalNotesResponses: responses.map(
					({ bytes, ...response }): SerializedCachedResponse => ({
						...response,
						bytesBase64: Buffer.from(bytes).toString("base64"),
					}),
				),
			},
		};
	if (responses.length && canProject && bridge?.projectResult) {
		try {
			return await bridge.projectResult(output, responses, callId, ctx, signal);
		} catch {
			throw new Error(
				"Remote contents were cached, but delivery failed. Retry this lookup on a compatible model.",
			);
		}
	}
	return output;
}

function createQueryExecutor(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	shared = false,
) {
	const assertActive = () => {
		if (!lifecycle.active)
			throw new Error("Notes continuity is unavailable in this session");
	};
	async function notes(
		callId: string,
		input: unknown,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<unknown>> {
		const help = discovery("notes", input);
		if (help) return help;
		assertActive();
		const raw = relevant("notes", input);
		const routed =
			!shared &&
			(await lifecycle.bridge?.route?.(
				{ namespace: "notes", params: raw },
				callId,
				ctx,
				signal,
			));
		if (routed) return routed;
		const params = relevant(
			"notes",
			normalizeNoteParams(raw, lifecycle.agent(ctx)),
		);
		if (signal?.aborted) throw new Error("Note operation cancelled");
		const local = useNotes(
			pi,
			store,
			params,
			ctx,
			lifecycle.agent(ctx),
			lifecycle.windows.current?.currentWindowId ?? "",
			lifecycle.runId,
			shared,
		);
		if (
			params["action"] === "write_file" ||
			params["action"] === "append_to_file"
		)
			return {
				...result(local),
				details: {
					...(shared
						? { codexHistoryNotes: {}, notesCompactionRouted: true }
						: {
								notesCompaction: {
									protocol: 1,
									saved: true,
									runId: lifecycle.runId,
								},
							}),
				},
			};
		const notes = collectNotes(store, ctx.sessionManager.getBranch());
		if (
			params["action"] === "read_file" &&
			notes.get(params["path"] as string)?.mode === "replace"
		)
			return result({
				source: "local",
				local,
				remote: { state: "superseded_by_local_replacement" },
			});
		const replacements = [...notes.values()]
			.filter((note) => note.mode === "replace")
			.map((note) => `${lifecycle.agent(ctx)}/notes/${note.path}`);
		const remoteParams = { ...params };
		for (const field of ["path", "prefix", "path_prefix"])
			if (typeof remoteParams[field] === "string")
				remoteParams[field] =
					`${lifecycle.agent(ctx)}/notes${remoteParams[field] ? `/${remoteParams[field]}` : ""}`;
		return hybrid(
			pi,
			store,
			lifecycle,
			{ namespace: "notes", params: remoteParams },
			{
				...local,
				...(replacements.length
					? {
							local_replacements_authoritative: replacements.slice(0, 100),
							replacements_truncated: replacements.length > 100,
						}
					: {}),
			},
			callId,
			ctx,
			signal,
			shared,
		);
	}
	async function history(
		callId: string,
		input: unknown,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
	): Promise<AgentToolResult<unknown>> {
		const help = discovery("history", input);
		if (help) return help;
		assertActive();
		const params = relevant("history", input);
		const query = { namespace: "history", params } as const;
		const routed =
			!shared && (await lifecycle.bridge?.route?.(query, callId, ctx, signal));
		if (routed) return routed;
		if (params["agent_name"] && params["agent_name"] !== lifecycle.agent(ctx))
			throw new Error(
				"That agent's history is not available here. Omit agent_name to search this session.",
			);
		return hybrid(
			pi,
			store,
			lifecycle,
			query,
			useHistory(
				ctx.sessionManager.getBranch(),
				params,
				ctx.sessionManager.getSessionId(),
			),
			callId,
			ctx,
			signal,
			shared,
		);
	}
	return { notes, history };
}

export function createSharedExecutor(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
) {
	const queries = createQueryExecutor(pi, store, lifecycle, true);
	return async (
		query: LookupQuery,
		callId: string,
		ctx: ExtensionContext,
		signal?: AbortSignal,
	): Promise<AgentToolResult<SharedNotesDetails>> => {
		const output = await queries[query.namespace](
			callId,
			query.params,
			signal,
			ctx,
		);
		return {
			...output,
			details: { codexHistoryNotes: {}, ...(output.details as object) },
		};
	};
}

export function createTools(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
): ToolDefinition[] {
	const assertActive = () => {
		if (!lifecycle.active)
			throw new Error("Notes continuity is unavailable in this session");
	};
	const queries = createQueryExecutor(pi, store, lifecycle);
	return [
		{
			name: "notes",
			label: "notes",
			description:
				"Cross-window notes. write_file replaces; append_to_file adds. Virtual paths: relative uses current agent; cross-agent uses <agent>/notes[/path].",
			parameters: NOTES_SCHEMA,
			executionMode: "sequential",
			prepareArguments(args) {
				if (args === undefined) return {};
				if (!args || typeof args !== "object" || Array.isArray(args))
					return args;
				const params = { ...args } as Record<string, unknown>;
				if (
					params["action"] === "list_files_by_prefix" &&
					params["max_files"] !== undefined
				) {
					params["max_results"] ??= params["max_files"];
					delete params["max_files"];
				}
				return params;
			},
			execute: (callId, input, signal, _update, ctx) =>
				queries.notes(callId, input, signal, ctx),
		},
		{
			name: "history",
			label: "history",
			description:
				"Prior-window detail. Pass IDs unchanged. Search, never browse",
			parameters: HISTORY_SCHEMA,
			prepareArguments(args) {
				return args === undefined ? {} : args;
			},
			execute: (callId, input, signal, _update, ctx) =>
				queries.history(callId, input, signal, ctx),
		},
		{
			name: "new_context",
			label: "new_context",
			description: "Start a new context window",
			parameters: Type.Object({}, { additionalProperties: false }),
			exposure: "model-only",
			executionMode: "sequential",
			async execute(_id, _input, signal, _update, ctx) {
				assertActive();
				if (signal?.aborted) throw new Error("Rollover cancelled");
				const started = lifecycle.requestRollover(ctx);
				if (started) ctx.abort();
				return {
					...result({
						started,
						message: started
							? lifecycle.normalCompaction
								? "Normal compaction will run before the new window opens"
								: "A new window will continue from your notes after this run settles"
							: "A checkpoint or rollover is already pending. Save notes and finish your response",
					}),
					...(started ? { terminate: true } : {}),
				};
			},
		},
		{
			name: "get_context_remaining",
			label: "get_context_remaining",
			description: "Remaining context tokens",
			parameters: Type.Object({}, { additionalProperties: false }),
			async execute(_id, _input, _signal, _update, ctx) {
				assertActive();
				const remaining = lifecycle.windows.remaining(ctx);
				return result({
					...remaining,
					remainingTokens: remaining.remainingTokens ?? null,
					remainingPercent: remaining.remainingPercent ?? null,
				});
			},
		},
	];
}
