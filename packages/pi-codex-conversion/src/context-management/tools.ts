import type {
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { createHistoryNotesTools } from "./history-notes.ts";
import { contextRemainingRenderers, newContextRenderers } from "./rendering.ts";

const EMPTY_PARAMETERS = Type.Object({}, { additionalProperties: false });

interface NewContextDetails {
	started: boolean;
}

export interface ContextRemainingDetails {
	remainingTokens?: number | undefined;
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
				"Start a new context window. Does not clear, reset, or otherwise affect environment state.",
			parameters: EMPTY_PARAMETERS,
			...newContextRenderers,
			executionMode: "sequential",
			async execute(_id, _params, signal, _update, ctx) {
				const plan = assertContextManagementActive(ctx, state);
				const started = plan.contextManagementMode === "tree"
					? state.contextTree.schedule(ctx)
					: await state.contextWindows.startNewWindow(pi, ctx, {
						triggerTurn: true,
						signal,
						mode: plan.contextManagementMode,
						trimPreviousWindow: true,
					});
				return {
					content: [
						{
							type: "text",
							text: started
								? "A new context window will start without summarizing conversation history."
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
			description: "Get the remaining tokens in the current context window.",
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
									: `You have ${remaining.remainingTokens} tokens left in this context window.`,
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
	const [history, notes] = createHistoryNotesTools(
		pi,
		(ctx) => resolveCodexRuntimePlanForState(ctx, state).contextManagementMode,
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
			"Codex context management requires an active Responses adapter with Context management enabled",
		);
	return plan;
}
