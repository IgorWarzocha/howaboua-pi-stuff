import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { obj } from "@earendil-works/pi-schema";
import type { LookupQuery, SharedNotesDetails } from "./bridge.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import type { createModelRoles } from "./model-roles.js";
import { NOTES_OUTPUT_SCHEMA } from "./note-result.js";
import { createQueryExecutor } from "./query-executor.js";
import type { NotesStore } from "./store.js";
import {
	HISTORY_SCHEMA,
	NEW_CONTEXT_DESCRIPTION,
	NOTES_DESCRIPTION,
	NOTES_ROUTING_GUIDELINE,
	NOTES_SCHEMA,
	newContextSchema,
	prepareHistoryArguments,
	prepareNewContextArguments,
	prepareNotesArguments,
	result,
} from "./tool-contracts.js";

export function createSharedExecutor(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	search: HistorySearch,
) {
	const queries = createQueryExecutor(pi, store, lifecycle, search, true);
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
	search: HistorySearch,
	roles: ReturnType<typeof createModelRoles>,
) {
	const assertActive = () => {
		if (!lifecycle.active)
			throw new Error(
				"Notes tools are inactive. Ask the user to check /notes.",
			);
	};
	const queries = createQueryExecutor(pi, store, lifecycle, search);
	const requestContext = async (
		id: string,
		input: unknown,
		signal: AbortSignal | undefined,
		ctx: ExtensionContext,
		parentCallId?: string,
	) => {
		assertActive();
		if (signal?.aborted) throw new Error("Rollover cancelled");
		const { role, resume = true } = prepareNewContextArguments(input);
		const handoff =
			role === undefined ? undefined : await roles.prepare(role, ctx);
		if (signal?.aborted) throw new Error("Rollover cancelled");
		const started = lifecycle.requestRollover(
			ctx,
			id,
			handoff,
			resume,
			parentCallId,
		);
		if (started && resume) ctx.abort();
		return {
			...result({
				started,
				message: started
					? !resume
						? "Window request queued without continuation. Finish your reply"
						: lifecycle.newWindowRequests === "pi-limits"
							? "Window request queued"
							: "New window queued"
					: "Checkpoint or rollover is already pending. Save notes and finish your response",
			}),
			...(started && resume ? { terminate: true } : {}),
		};
	};
	const tools: ToolDefinition[] = [
		{
			name: "notes",
			label: "notes",
			description: NOTES_DESCRIPTION,
			promptGuidelines: [NOTES_ROUTING_GUIDELINE],
			parameters: NOTES_SCHEMA,
			outputSchema: NOTES_OUTPUT_SCHEMA,
			executionMode: "sequential",
			prepareArguments: prepareNotesArguments,
			execute: (callId, input, signal, _update, ctx) =>
				queries.notes(callId, input, signal, ctx),
		},
		{
			name: "history",
			label: "history",
			description: "Search past chat",
			parameters: HISTORY_SCHEMA,
			prepareArguments(args) {
				return prepareHistoryArguments(args);
			},
			execute: (callId, input, signal, _update, ctx) =>
				queries.history(callId, input, signal, ctx),
		},
		{
			name: "new_context",
			label: "new_context",
			description: NEW_CONTEXT_DESCRIPTION,
			parameters: newContextSchema([]),
			prepareArguments: prepareNewContextArguments,
			exposure: "model-only",
			executionMode: "sequential",
			execute: (id, input, signal, _update, ctx) =>
				requestContext(id, input, signal, ctx),
		},
		{
			name: "get_context_remaining",
			label: "get_context_remaining",
			description: "Remaining context tokens",
			parameters: obj({}, { open: false }),
			async execute(_id, _input, _signal, _update, ctx) {
				assertActive();
				const remaining = lifecycle.windows.remaining(ctx);
				return result({
					contextWindow: remaining.contextWindow,
					remainingTokens: remaining.remainingTokens ?? null,
					remainingPercent: remaining.remainingPercent ?? null,
				});
			},
		},
	];
	const newContext = tools.find((tool) => tool.name === "new_context")!;
	let roleIds: string[] = [];
	let advertised = "";
	const refresh = () => {
		const schema = newContextSchema(roleIds, lifecycle.taskCompletionRollover);
		const key = JSON.stringify(schema);
		if (key === advertised) return;
		advertised = key;
		newContext.parameters = schema;
		pi.registerTool(newContext);
	};
	roles.onRoleIdsChanged((ids) => {
		roleIds = ids;
		refresh();
	});
	return { tools, refresh, requestContext };
}
