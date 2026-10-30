import type { createCodexSessionLifecycle } from "./session-lifecycle.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { syncAdapter } from "../adapter/activation/activation.ts";
import { isAdapterRuntime, isCodeModeRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { hasNoSkillsFlag } from "../adapter/prompt/skills.ts";
import { prepareCodexSystemPrompt, resolvePromptSkills } from "../prompt/build-system-prompt.ts";
import { projectCodeModeMcpSections } from "../prompt/mcp-server-section.ts";
import { CODE_MODE_TOOL_NAMES, NOTEBOOK_MODE_TOOL_NAMES } from "../adapter/activation/tool-set.ts";
import { getPiCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexUiController } from "./ui.ts";
import { flushCodexReasoningUpdates, recordCodexReasoningUpdate } from "../adapter/reasoning-updates.ts";
import type { createCodexReserveController } from "../codex-usage/reserve.ts";
import { recordCurrentTimeReminder } from "../adapter/current-time-reminder.ts";
import { recordCodexContextBriefings } from "../context-briefings.ts";
import { recordCodeModeToolkit } from "../adapter/code-mode/toolkit-updates.ts";
import { recordNotebookStatus } from "../adapter/notebook-status.ts";
import { captureNativeCompactionContext } from "../adapter/replay/context.ts";
import type { ExtensionHandler, InputEvent, BeforeAgentStartEvent, AgentStartEvent, AgentSettledEvent, ContextWithSystemEvent, InputEventResult, BeforeAgentStartEventResult, ContextEventResult } from "@earendil-works/pi-coding-agent";

export function createCodexTurnLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	ui: CodexUiController,
	codeMode: CodeModeRegistration,
	reserve: ReturnType<typeof createCodexReserveController>,
	session: Pick<ReturnType<typeof createCodexSessionLifecycle>, "activate" | "flushToolRefresh">,
) {
	const { state } = runtime;
	const refreshNotebookStatus = (
		ctx: ExtensionContext,
		messages?: readonly AgentMessage[],
		selectedTools = pi.getActiveTools(),
	): Promise<boolean> => {
		const kind = resolveCodexRuntimePlanForState(ctx, state).kind;
		if ((kind !== "notebook" && kind !== "ts" && kind !== "js")
			|| !["exec", "wait", "notebook"].every((name) => selectedTools.includes(name))) return Promise.resolve(false);
		return recordNotebookStatus(pi, ctx, state, messages ?? runtime.projectContextMessages(ctx), codeMode, kind);
	};

	return {
		input: async (event, ctx) => {
			if (event.streamingBehavior === undefined) {
				session.activate(ctx);
				syncAdapter(pi, ctx, state);
			}
			if (event.source !== "extension") runtime.voice.piInput(event.text, event.streamingBehavior);
		},
		beforeAgentStart: async (event, ctx) => {
			session.activate(ctx);
			state.codexTurnState.beginTurn();
			if (!state.config.voiceFeaturesOnly) await reserve.beforeTurn(ctx);
			runtime.autoReasoning.begin(ctx);
			const plan = syncAdapter(pi, ctx, state);
			if (plan.kind !== "notebook" && plan.kind !== "ts" && plan.kind !== "js") state.notebookStatusMessageId = undefined;
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
			return undefined;
		},
		agentStarted: async (_event, ctx) => {
			runtime.autoReasoning.begin(ctx);
			runtime.cancelCacheKeepalive();
			// Final serialization sees every extension's prompt and native tool edits.
			runtime.prepareTurn(ctx);
			runtime.voice.agentStarted();
			runtime.lanVoice.agentStarted();
		},
		agentSettled: async (_event, ctx) => {
			runtime.finishTurn();
			flushCodexReasoningUpdates(pi, ctx);
			runtime.autoReasoning.settle(ctx);
			const quotaExhausted = !state.config.voiceFeaturesOnly && await reserve.settled(ctx);
			session.flushToolRefresh(ctx);
			state.codexTurnState.reset();
			runtime.voice.settleTurn();
			runtime.lanVoice.agentSettled();
			if (!state.config.voiceFeaturesOnly) void ui.refreshUsageStatus(ctx);
			if (!quotaExhausted) runtime.armCacheKeepalive(ctx);
		},
		contextWithSystem: async (event, ctx) => {
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			try {
				captureNativeCompactionContext(event.messages, ctx, state);
				await recordCodexContextBriefings(pi, ctx, undefined, runtime.projectContextMessages(ctx, event.messages));
			} catch (error) {
				ctx.abort();
				throw error;
			}
			let messages = runtime.projectContextMessages(ctx, event.messages);
			if (await refreshNotebookStatus(ctx, messages))
				messages = runtime.projectContextMessages(ctx, event.messages);
			if (isCodeModeRuntime(resolveCodexRuntimePlanForState(ctx, state)) && recordCodeModeToolkit(pi, ctx, messages, codeMode.getTools(ctx), codeMode.getPromptTools(ctx)))
				messages = runtime.projectContextMessages(ctx, event.messages);
			const developerMessages = supportsCodexDeveloperMessages(ctx, state);
			if (developerMessages && recordCurrentTimeReminder(pi, ctx, messages, state.config.prompt.currentTimeReminderMinutes))
				messages = runtime.projectContextMessages(ctx, event.messages);
			const required = plan.kind === "notebook" || plan.kind === "ts" || plan.kind === "js" ? NOTEBOOK_MODE_TOOL_NAMES : CODE_MODE_TOOL_NAMES;
			try {
				messages = projectCodeModeMcpSections(messages, isCodeModeRuntime(plan)
					&& required.every(name => pi.getActiveTools().includes(name)));
			} catch (error) {
				// Pi reports hook errors and continues; abort rather than send unadapted discovery guidance.
				ctx.abort();
				throw error;
			}
			// Tool results are persisted by this boundary. Commit selector changes here,
			// before the next provider request, rather than waiting for agent settlement.
			flushCodexReasoningUpdates(pi, ctx);
			messages = runtime.projectContextMessages(ctx, messages);
			return {
				messages: state.developerMessages.prepare(
					messages,
					developerMessages,
					ctx.model,
				),
			};
		},
		refreshNotebookStatus,
	} satisfies {
		refreshNotebookStatus: (ctx: ExtensionContext, messages?: readonly AgentMessage[], selectedTools?: string[]) => Promise<boolean>;
		input: ExtensionHandler<InputEvent, InputEventResult>;
		beforeAgentStart: ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;
		agentStarted: ExtensionHandler<AgentStartEvent>;
		agentSettled: ExtensionHandler<AgentSettledEvent>;
		contextWithSystem: ExtensionHandler<ContextWithSystemEvent, ContextEventResult>;
	};
}
