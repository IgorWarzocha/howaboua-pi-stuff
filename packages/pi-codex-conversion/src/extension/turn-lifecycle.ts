import type { createCodexSessionLifecycle } from "./session-lifecycle.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { syncAdapter } from "../adapter/activation/activation.ts";
import { isAdapterRuntime, isCodeModeRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { hasNoSkillsFlag } from "../adapter/prompt/skills.ts";
import { prepareCodexSystemPrompt, resolvePromptSkills } from "../prompt/build-system-prompt.ts";
import { getPiCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexUiController } from "./ui.ts";
import { updateCodexPreparedIdleKickoff } from "../developer-messages.ts";
import { flushCodexReasoningUpdates, recordCodexReasoningUpdate } from "../adapter/reasoning-updates.ts";
import type { createCodexReserveController } from "../codex-usage/reserve.ts";
import { recordCurrentTimeReminder } from "../adapter/current-time-reminder.ts";
import { recordCodeModeToolkit } from "../adapter/code-mode/toolkit-updates.ts";
import { recordNotebookStatus } from "../adapter/notebook-status.ts";
import type { ExtensionHandler, TurnEndEvent, InputEvent, BeforeAgentStartEvent, AgentStartEvent, AgentSettledEvent, ContextWithSystemEvent, TurnEndEventResult, InputEventResult, BeforeAgentStartEventResult, ContextEventResult } from "@earendil-works/pi-coding-agent";

export function createCodexTurnLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	ui: CodexUiController,
	codeMode: CodeModeRegistration,
	reserve: ReturnType<typeof createCodexReserveController>,
	session: Pick<ReturnType<typeof createCodexSessionLifecycle>, "activate" | "flushToolRefresh">,
) {
	const { state } = runtime;
	const startManualNotesWindow = async (ctx: ExtensionContext): Promise<boolean> => {
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		try {
			const rolled = plan.contextManagementMode === "tree"
				? state.contextTree.schedule(ctx, { triggerTurn: false }) && await state.contextTree.settle(pi, ctx)
				: await state.contextKickoff.startWindow(pi, ctx, {
					triggerTurn: false,
					mode: plan.contextManagementMode,
					trimPreviousWindow: true,
				});
			if (rolled) runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
			else if (plan.contextManagementMode !== "tree") ctx.ui.notify("Context rollover did not start", "warning");
			return rolled;
		} catch (error) {
			ctx.ui.notify(`Context rollover failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			return false;
		}
	};
	const refreshNotebookStatus = (
		ctx: ExtensionContext,
		messages?: readonly AgentMessage[],
		selectedTools = pi.getActiveTools(),
	): Promise<boolean> => {
		if (resolveCodexRuntimePlanForState(ctx, state).kind !== "notebook"
			|| !["exec", "wait", "notebook"].every((name) => selectedTools.includes(name))) return Promise.resolve(false);
		return recordNotebookStatus(pi, ctx, state, messages ?? runtime.projectContextMessages(ctx), codeMode);
	};

	return {
		turnEnded: (event, ctx) => {
			flushCodexReasoningUpdates(pi, ctx);
			if (event.message.role !== "assistant") return;
			if (ctx.signal?.aborted || event.message.stopReason === "error" || event.message.stopReason === "length" || event.message.stopReason === "aborted") {
				state.contextWindows.cancelScheduledCompaction();
				return;
			}
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			if (state.contextWindows.finishTurn(ctx, async () => {
				let continued = false;
				try {
					if (plan.contextManagementMode === "tree") {
						runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
						await state.contextTree.settle(pi, ctx);
					} else await state.contextKickoff.startWindow(pi, ctx, {
						mode: plan.contextManagementMode, triggerTurn: true, trimPreviousWindow: false,
					});
					continued = state.contextKickoff.continue(pi, ctx);
				} finally {
					if (!continued) runtime.autoReasoning.settle(ctx);
				}
			})) return;
			if (state.contextTree.handoff.active) return;
			const reminder = state.contextWindows.recordBudget(ctx, plan.contextManagement ? plan.contextManagementMode : "off");
			if (reminder) return { entries: [...event.entries, reminder], continue: true };
		},
		input: async (event, ctx) => {
			const intercepted = state.contextTree.interceptInput(event);
			if (intercepted) return intercepted;
			if (event.streamingBehavior === undefined) {
				session.activate(ctx);
				state.codexTurnState.beginTurn();
				const plan = syncAdapter(pi, ctx, state);
				state.contextWindows.ensureInitialized(
					pi,
					ctx,
					plan.contextManagement,
				);
			}
			if (event.source !== "extension")
				runtime.voice.piInput(event.text, event.streamingBehavior);
		},
		beforeAgentStart: async (event, ctx) => {
			state.contextTree.handoff.preparing(event.prompt);
			if (!state.config.voiceFeaturesOnly) await reserve.beforeTurn(ctx);
			runtime.autoReasoning.begin(ctx);
			const plan = syncAdapter(pi, ctx, state);
			if (!state.contextWindows.currentIdentity()) state.contextWindows.ensureInitialized(pi, ctx, plan.contextManagement);
			if (plan.kind !== "notebook") state.notebookStatusMessageId = undefined;
			if (!isAdapterRuntime(plan)) {
				state.preparedPrompt = undefined;
				return undefined;
			}
			recordCodexReasoningUpdate(pi, ctx, runtime.projectContextMessages(ctx));
			const skills = resolvePromptSkills(event.systemPromptOptions?.skills, hasNoSkillsFlag() ? [] : state.promptSkills);
			prepareCodexSystemPrompt(event.systemPromptOptions, {
				skills,
				shell: getPiCodexRuntimeShell(ctx),
				mode: plan.prompt ?? "normal",
				heavySystemPromptOverwrite: state.config.prompt.heavySystemPromptOverwrite,
			});
			await refreshNotebookStatus(ctx, runtime.projectContextMessages(ctx), event.systemPromptOptions.selectedTools);
		},
		agentStarted: async (_event, ctx) => {
			updateCodexPreparedIdleKickoff(pi, "agent_start");
			state.contextWindows.beginPromptedManualCheckpointRun();
			state.contextTree.handoff.started(ctx);
			runtime.autoReasoning.begin(ctx);
			runtime.cancelCacheKeepalive();
			// Final serialization sees every extension's prompt and native tool edits.
			runtime.prepareTurn(ctx);
			runtime.voice.agentStarted();
			runtime.lanVoice.agentStarted();
		},
		agentSettled: async (_event, ctx) => {
			runtime.finishTurn();
			updateCodexPreparedIdleKickoff(pi, "agent_settled");
			flushCodexReasoningUpdates(pi, ctx);
			// Rollover compaction aborts this run before its successor exists.
			const continuingWork = state.contextWindows.isRolloverCompactionRunning()
				|| state.contextTree.rolloverPending || state.contextKickoff.pending;
			if (!continuingWork) runtime.autoReasoning.settle(ctx);
			// Reserve must capture the user's restored level, never a temporary auto-reasoning override.
			const quotaExhausted = !continuingWork && !state.config.voiceFeaturesOnly && await reserve.settled(ctx);
			let rolled = false;
			let continued = false;
			try {
				session.flushToolRefresh(ctx);
				state.codexTurnState.reset();
				runtime.voice.settleTurn();
				runtime.lanVoice.agentSettled();
				if (!state.config.voiceFeaturesOnly) void ui.refreshUsageStatus(ctx);
				rolled = await state.contextTree.settle(pi, ctx);
				if (rolled) runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
				state.contextTree.handoff.settled(ctx);
				const plan = resolveCodexRuntimePlanForState(ctx, state);
				const manualCheckpoint = state.contextWindows.finishPromptedManualCheckpoint(ctx,
					plan.contextManagement && !plan.compactOnRollover);
				if (manualCheckpoint === "ready") rolled = await startManualNotesWindow(ctx) || rolled;
				else if (manualCheckpoint === "missing")
					ctx.ui.notify("Context rollover did not start: no note was saved in the completed run", "warning");
				continued = state.contextKickoff.continue(pi, ctx);
			} finally {
				if (continuingWork && !continued && !state.contextWindows.isRolloverCompactionRunning()) runtime.autoReasoning.settle(ctx);
			}
			if (!rolled && !continued && !quotaExhausted && !state.contextWindows.isRolloverCompactionRunning()) runtime.armCacheKeepalive(ctx);
		},
		contextWithSystem: async (event, ctx) => {
			let messages = runtime.projectContextMessages(ctx, event.messages);
			if (await refreshNotebookStatus(ctx, messages))
				messages = runtime.projectContextMessages(ctx, event.messages);
			if (isCodeModeRuntime(resolveCodexRuntimePlanForState(ctx, state)) && recordCodeModeToolkit(pi, ctx, messages, codeMode.getTools(ctx)))
				messages = runtime.projectContextMessages(ctx, event.messages);
			const developerMessages = supportsCodexDeveloperMessages(ctx, state);
			if (developerMessages && recordCurrentTimeReminder(pi, ctx, messages, state.config.prompt.currentTimeReminderMinutes))
				messages = runtime.projectContextMessages(ctx, event.messages);
			return {
				messages: state.developerMessages.prepare(
					messages,
					developerMessages,
					ctx.model,
				),
			};
		},
		startManualNotesWindow,
		refreshNotebookStatus,
	} satisfies {
		startManualNotesWindow: (ctx: ExtensionContext) => Promise<boolean>;
		refreshNotebookStatus: (ctx: ExtensionContext, messages?: readonly AgentMessage[], selectedTools?: string[]) => Promise<boolean>;
		turnEnded: ExtensionHandler<TurnEndEvent, TurnEndEventResult>;
		input: ExtensionHandler<InputEvent, InputEventResult>;
		beforeAgentStart: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;
		agentStarted: ExtensionHandler<AgentStartEvent>;
		agentSettled: ExtensionHandler<AgentSettledEvent>;
		contextWithSystem: ExtensionHandler<ContextWithSystemEvent, ContextEventResult>;
	};
}
