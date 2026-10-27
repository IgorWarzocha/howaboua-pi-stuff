import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { LookupQuery, SharedNotesDetails } from "./bridge.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { createQueryExecutor } from "./query-executor.js";
import type { NotesStore } from "./store.js";
import {
	HISTORY_SCHEMA,
	NEW_CONTEXT_DESCRIPTION,
	NOTES_DESCRIPTION,
	NOTES_SCHEMA,
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
): ToolDefinition[] {
	const assertActive = () => {
		if (!lifecycle.active)
			throw new Error(
				"Notes tools are inactive. Ask the user to check /notes.",
			);
	};
	const queries = createQueryExecutor(pi, store, lifecycle, search);
	return [
		{
			name: "notes",
			label: "notes",
			description: NOTES_DESCRIPTION,
			parameters: NOTES_SCHEMA,
			executionMode: "sequential",
			prepareArguments: prepareNotesArguments,
			execute: (callId, input, signal, _update, ctx) =>
				queries.notes(callId, input, signal, ctx),
		},
		{
			name: "history",
			label: "history",
			description: "Search earlier conversation",
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
			description: NEW_CONTEXT_DESCRIPTION,
			parameters: Type.Object({}, { additionalProperties: false }),
			exposure: "model-only",
			executionMode: "sequential",
			async execute(id, _input, signal, _update, ctx) {
				assertActive();
				if (signal?.aborted) throw new Error("Rollover cancelled");
				const started = lifecycle.requestRollover(ctx, id);
				if (started) ctx.abort();
				return {
					...result({
						started,
						message: started
							? lifecycle.newWindowRequests === "pi-limits"
								? "Window request queued. Pi will check whether enough history can be compacted"
								: "A new window will open after this run settles"
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
					contextWindow: remaining.contextWindow,
					remainingTokens: remaining.remainingTokens ?? null,
					remainingPercent: remaining.remainingPercent ?? null,
				});
			},
		},
	];
}
