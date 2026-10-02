import type {
	AgentToolResult,
	ExtensionAPI,
	ExtensionContext,
	ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { createHistoryNotesTools } from "./history-notes.ts";
import { registerCodeModeExtensionTools } from "../code-mode-extension-tools.ts";
import { toNestedTool } from "../adapter/code-mode/nested-tool-adapter.ts";
import { remoteBackendScope, withRemoteContextScope } from "./remote-scope.ts";
import { registerContextSharingService } from "./sharing-service.ts";
import { contextRemainingRenderers, newContextRenderers } from "./rendering.ts";
import { HISTORY_NESTED_USAGE, NOTES_NESTED_USAGE } from "./tool-contract.ts";

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
	// Reuse the registered routers, including family routing and Tree write completion.
	const contract = { deferLoading: true, discoverWhenDeferred: true, modelVisibleResult: true,
		opaqueResultScope: (result: AgentToolResult<unknown>) => {
			const details = result.details;
			return remoteBackendScope(details && typeof details === "object" && "codexHistoryNotes" in details
				? details.codexHistoryNotes : undefined);
		} };
	const nestedTools = (remote: boolean) => [
		toNestedTool(history, "await tools.history({ action, ...args })", {}, { ...contract, opaqueResult: remote }),
		toNestedTool(notes, "await tools.notes({ action, ...args })", {}, {
			...contract,
			opaqueResult: remote,
			propagateTermination: true,
			isContextNoteWrite: (input) => Boolean(input && typeof input === "object" && "action" in input &&
				(input.action === "write_file" || input.action === "append_to_file")),
		}),
	].map((tool) => ({
		...tool,
		discoveryUsage: tool.name === "history" ? HISTORY_NESTED_USAGE : NOTES_NESTED_USAGE,
		...(remote ? {
			output: "Receipts only; contents reach the model automatically, not JavaScript",
		} : {}),
		invoke: async (...[input, context, signal]: Parameters<typeof tool.invoke>) => {
			if (!context.extensionContext || !plan(context.extensionContext).contextManagementNested)
				throw new Error("Nested history and notes require active context in Code or Notebook");
			if (plan(context.extensionContext).contextManagementRemote !== remote)
				throw new Error("Context storage changed; start a new exec cell");
			return tool.invoke(input, remote ? { ...context,
				extensionContext: withRemoteContextScope(context.extensionContext, context.opaqueScope) } : context, signal);
		},
	}));
	const nested = nestedTools(false);
	const remoteNested = nestedTools(true);
	registerCodeModeExtensionTools(pi, (ctx) => ctx && plan(ctx).contextManagementNested
		? plan(ctx).contextManagementRemote ? remoteNested : nested
		: []);
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
