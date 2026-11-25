import type { createCodexSessionLifecycle } from "./session-lifecycle.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { syncAdapter } from "../adapter/activation/activation.ts";
import {
	isAdapterRuntime,
	usesExecTools,
	resolveAdapterRuntimePlanForState,
} from "../adapter/activation/runtime-plan.ts";
import { supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { prepareCodexSystemPrompt } from "../prompt/build-system-prompt.ts";
import { projectCodeModeMcpSections } from "../prompt/mcp-server-section.ts";
import { orderProjectContextLast } from "../prompt/project-context-order.ts";
import {
	EXEC_TOOL_NAMES,
	TS_NOTEBOOK_TOOL_NAMES,
} from "../adapter/activation/tool-set.ts";
import { getPiCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexUiController } from "./ui.ts";
import type { CodexShellLifecycle } from "./shell-lifecycle.ts";
import {
	flushCodexReasoningUpdates,
	recordCodexReasoningUpdate,
} from "../adapter/reasoning-updates.ts";
import type { createCodexReserveController } from "../codex-usage/reserve.ts";
import { recordCurrentTimeReminder } from "../adapter/current-time-reminder.ts";
import { recordCodexContextBriefings } from "../context-briefings.ts";
import { recordCodeModeToolkit } from "../adapter/code-mode/toolkit-updates.ts";
import { recordBindingStatus } from "../adapter/binding-status.ts";
import { captureNativeCompactionContext } from "../adapter/replay/context.ts";
import type {
	ExtensionHandler,
	InputEvent,
	BeforeAgentStartEvent,
	AgentStartEvent,
	AgentSettledEvent,
	ContextWithSystemEvent,
	InputEventResult,
	BeforeAgentStartEventResult,
	ContextEventResult,
} from "@earendil-works/pi-coding-agent";

export function createCodexTurnLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	ui: CodexUiController,
	codeMode: CodeModeRegistration,
	reserve: ReturnType<typeof createCodexReserveController>,
	session: Pick<
		ReturnType<typeof createCodexSessionLifecycle>,
		"activate" | "flushToolRefresh"
	>,
	shells: CodexShellLifecycle,
) {
	const { state } = runtime;
	const refreshBindingStatus = (
		ctx: ExtensionContext,
		messages: readonly AgentMessage[],
	): Promise<boolean> => {
		const kind = resolveAdapterRuntimePlanForState(ctx, state).kind;
		if (kind !== "ts" && kind !== "vm") return Promise.resolve(false);
		const required = kind === "ts" ? TS_NOTEBOOK_TOOL_NAMES : EXEC_TOOL_NAMES;
		const selectedTools = pi.getActiveTools();
		if (!required.every((name) => selectedTools.includes(name)))
			return Promise.resolve(false);
		return recordBindingStatus(pi, ctx, state, kind, messages, codeMode);
	};

	return {
		input: async (event, ctx) => {
			if (event.streamingBehavior === undefined) {
				session.activate(ctx);
				syncAdapter(pi, ctx, state);
			}
			if (event.source !== "extension")
				runtime.voice.piInput(event.text, event.streamingBehavior);
		},
		beforeAgentStart: async (event, ctx) => {
			session.activate(ctx);
			state.codexTurnState.beginTurn();
			await reserve.beforeTurn(ctx);
			runtime.autoReasoning.begin(ctx);
			const plan = syncAdapter(pi, ctx, state);
			if (plan.kind !== state.bindingStatus?.kind)
				state.bindingStatus = undefined;
			if (!isAdapterRuntime(plan)) {
				state.preparedPrompt = undefined;
				return undefined;
			}
			recordCodexReasoningUpdate(pi, ctx, runtime.projectContextMessages(ctx));
			prepareCodexSystemPrompt(event.systemPromptOptions, {
				shell: getPiCodexRuntimeShell(ctx),
				executionMode: plan.kind,
				heavySystemPromptOverwrite:
					state.config.prompt.heavySystemPromptOverwrite,
			});
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
			const quotaExhausted = await reserve.settled(ctx);
			session.flushToolRefresh(ctx);
			state.codexTurnState.reset();
			runtime.voice.settleTurn();
			runtime.lanVoice.agentSettled();
			void ui.refreshUsageStatus(ctx);
			if (!quotaExhausted) runtime.armCacheKeepalive(ctx);
		},
		contextWithSystem: async (event, ctx) => {
			const plan = resolveAdapterRuntimePlanForState(ctx, state);
			try {
				captureNativeCompactionContext(event.messages, ctx, state);
				await recordCodexContextBriefings(
					pi,
					ctx,
					undefined,
					runtime.projectContextMessages(ctx, event.messages),
				);
			} catch (error) {
				ctx.abort();
				throw error;
			}
			let messages = runtime.projectContextMessages(ctx, event.messages);
			if (
				usesExecTools(resolveAdapterRuntimePlanForState(ctx, state)) &&
				recordCodeModeToolkit(
					pi,
					ctx,
					messages,
					codeMode.getTools(ctx),
					codeMode.getPromptTools(ctx),
				)
			)
				messages = runtime.projectContextMessages(ctx, event.messages);
			// Keep the stable toolkit before each new inventory without relocating sent history.
			if (await refreshBindingStatus(ctx, messages))
				messages = runtime.projectContextMessages(ctx, event.messages);
			const developerMessages = supportsCodexDeveloperMessages(ctx, state);
			if (
				developerMessages &&
				recordCurrentTimeReminder(
					pi,
					ctx,
					messages,
					state.config.prompt.currentTimeReminderMinutes,
				)
			)
				messages = runtime.projectContextMessages(ctx, event.messages);
			// Runtime shell state follows the admitted conversation and other notices, never the static prefix.
			if (shells.recordBriefing(ctx, messages))
				messages = runtime.projectContextMessages(ctx, event.messages);
			const required =
				plan.kind === "ts" ? TS_NOTEBOOK_TOOL_NAMES : EXEC_TOOL_NAMES;
			try {
				messages = projectCodeModeMcpSections(
					messages,
					usesExecTools(plan) &&
						required.every((name) => pi.getActiveTools().includes(name)),
				);
			} catch (error) {
				// Pi reports hook errors and continues; abort rather than send unadapted discovery guidance.
				ctx.abort();
				throw error;
			}
			// Tool results are persisted by this boundary. Commit selector changes here,
			// before the next provider request, rather than waiting for agent settlement.
			flushCodexReasoningUpdates(pi, ctx);
			messages = runtime.projectContextMessages(ctx, messages);
			const head = messages[0];
			if (head?.role === "system" && isAdapterRuntime(plan))
				messages[0] = orderProjectContextLast(head);
			return {
				messages: state.developerMessages.prepare(
					messages,
					developerMessages,
					ctx.model,
				),
			};
		},
	} satisfies {
		input: ExtensionHandler<InputEvent, InputEventResult>;
		beforeAgentStart: ExtensionHandler<
			BeforeAgentStartEvent,
			BeforeAgentStartEventResult
		>;
		agentStarted: ExtensionHandler<AgentStartEvent>;
		agentSettled: ExtensionHandler<AgentSettledEvent>;
		contextWithSystem: ExtensionHandler<
			ContextWithSystemEvent,
			ContextEventResult
		>;
	};
}
