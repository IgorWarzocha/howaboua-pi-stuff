import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { createHistoryNotesTools } from "./history-notes.ts";
import { registerContextSharingService } from "./sharing-service.ts";
import { contextRemainingRenderers, newContextRenderers } from "./rendering.ts";

const EMPTY_PARAMETERS = Type.Object({}, { additionalProperties: false });

interface NewContextDetails {
	started: boolean;
}

export interface ContextRemainingDetails {
	remainingTokens?: number | undefined;
	remainingPercent?: number | undefined;
	windowId?: string | undefined;
	contextWindow: number;
}

export function createContextWindowTools(
	pi: ExtensionAPI,
	state: AdapterState,
): [
	ToolDefinition<typeof EMPTY_PARAMETERS, NewContextDetails>,
	ToolDefinition<typeof EMPTY_PARAMETERS, ContextRemainingDetails>,
] {
	return [
		{
			name: "new_context",
			label: "new_context",
			description:
				"Start a new context window; environment state is unchanged",
			parameters: EMPTY_PARAMETERS,
			...newContextRenderers,
			executionMode: "sequential",
			async execute(_id, _params, signal, _update, ctx) {
				const plan = assertContextManagementActive(ctx, state);
				const started = plan.compactOnRollover
					? state.contextWindows.scheduleRolloverCompaction()
					: plan.contextManagementMode === "tree"
					? state.contextTree.schedule(ctx)
					: await state.contextKickoff.startWindow(pi, ctx, {
						triggerTurn: true,
						signal,
						mode: plan.contextManagementMode,
						trimPreviousWindow: true,
					});
				// Pi's terminate flag only stops a batch when every result terminates.
				if (started && !plan.compactOnRollover) ctx.abort();
				return {
					...(started ? { terminate: true } : {}),
					content: [
						{
							type: "text",
							text: started
								? plan.compactOnRollover
									? "A new context window will continue from a compaction checkpoint."
									: "A new context window will start without summarizing conversation history."
								: "A new context window is already scheduled.",
						},
					],
					details: { started },
				};
			},
		},
		{
			name: "get_context_remaining",
			label: "get_context_remaining",
			description: "Remaining context tokens",
			parameters: EMPTY_PARAMETERS,
			...contextRemainingRenderers,
			async execute(_id, _params, _signal, _update, ctx) {
				assertContextManagementActive(ctx, state);
				const remaining = state.contextWindows.remaining(ctx);
				return {
					content: [
						{
							type: "text",
							text:
								remaining.remainingTokens === undefined
									? "You have unknown tokens left in this context window."
									: `${remaining.remainingPercent}% remaining (${remaining.remainingTokens} of ${remaining.contextWindow} tokens).`,
						},
					],
					details: remaining,
				};
			},
		},
	];
}

export function registerContextManagementTools(
	pi: ExtensionAPI,
	state: AdapterState,
): void {
	const [newContext, getContextRemaining] = createContextWindowTools(pi, state);
	const plan = (ctx: ExtensionContext) => resolveCodexRuntimePlanForState(ctx, state);
	const mode = (ctx: ExtensionContext) => plan(ctx).contextManagementMode;
	const route = registerContextSharingService(pi, plan, async (ctx, request, signal) => {
		return request.namespace === "history"
			? history.execute("shared-context", request.params as Parameters<typeof history.execute>[1], signal, undefined, ctx)
			: notes.execute("shared-context", request.params as Parameters<typeof notes.execute>[1], signal, undefined, ctx);
	});
	const [history, notes] = createHistoryNotesTools(
		pi,
		mode,
		(action, path, ctx) => () => state.contextTree.handoff.finishNoteWrite(action, path, ctx),
		route,
	);
	pi.registerTool(newContext);
	pi.registerTool(getContextRemaining);
	pi.registerTool(history);
	pi.registerTool(notes);
}

function assertContextManagementActive(
	ctx: ExtensionContext,
	state: AdapterState,
): ReturnType<typeof resolveCodexRuntimePlanForState> {
	const plan = resolveCodexRuntimePlanForState(ctx, state);
	if (!plan.contextManagement)
		throw new Error(
			"Context tools require an active Responses adapter with a notes-based continuity strategy",
		);
	return plan;
}
