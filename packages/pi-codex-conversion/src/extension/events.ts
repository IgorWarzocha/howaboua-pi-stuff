import { randomUUID } from "node:crypto";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { syncAdapter } from "../adapter/activation/activation.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { hasPortableNativeCompactionSummary, isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, NATIVE_COMPACTION_PORTABLE_DISPLAY_TEXT, NATIVE_COMPACTION_STRATEGY, type NativeCompactionDisplayEntry, type NativeCompactionUsage } from "../adapter/compaction/types.ts";
import { findLatestCompactionEntry } from "../adapter/compaction/details-store.ts";
import { handleCodexSessionBeforeCompact } from "../adapter/compaction/compaction.ts";
import { rewriteCodexProviderHeaders, rewriteCodexProviderRequest, supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { hasNoSkillsFlag } from "../adapter/prompt/skills.ts";
import { onCodeModeExtensionToolsRefresh } from "../code-mode-extension-tools.ts";
import { extractPiPromptSkills, prepareCodexSystemPrompt, resolvePromptSkills } from "../prompt/build-system-prompt.ts";
import { getPiCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import { maybeWarnLocalCheckoutVersion } from "../adapter/local-version-warning.ts";
import { clearApplyPatchRenderState } from "../tools/apply-patch/tool.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { parseRealtimeVoicePrompt, REALTIME_VOICE_PROMPT_CHANNEL } from "../realtime-voice.ts";
import { initializeBashParser } from "../shell/bash.ts";
import { appendNotebookTreeEpoch } from "../tools/notebook-mode/session-identity.ts";
import { formatCompactionCacheDiagnostic } from "../adapter/compaction/diagnostics.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";
import { CODEX_DEVELOPER_MESSAGE_TYPE, registerCodexDeveloperMessageBroker, updateCodexPreparedIdleKickoff } from "../developer-messages.ts";
import { isContextWindowCompactionDetails } from "../context-management/messages.ts";
import { flushCodexReasoningUpdates, recordCodexReasoningUpdate } from "../adapter/reasoning-updates.ts";
import { createCodexReserveController } from "../codex-usage/reserve.ts";
import { recordCurrentTimeReminder } from "../adapter/current-time-reminder.ts";

function formatCompactionUsage(usage: NativeCompactionUsage): string {
	const ratio = usage.inputTokens > 0 ? `${((usage.cachedInputTokens / usage.inputTokens) * 100).toFixed(1)}%` : "0%";
	const tokens = (value: number) => Math.round(value).toLocaleString("en-US");
	const diagnostic = formatCompactionCacheDiagnostic(usage, usage.diagnostic);
	return `Compaction V2 · input ${tokens(usage.inputTokens)} · cache read ${tokens(usage.cachedInputTokens)} (${ratio}) · cache write ${tokens(usage.cacheWriteInputTokens)} · output ${tokens(usage.outputTokens)}${diagnostic ? ` ${diagnostic}` : ""}`;
}

function commandArg(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("cmd" in args) || typeof args.cmd !== "string") return undefined;
	return args.cmd;
}

function isToolCallOnlyAssistantMessage(message: unknown): boolean {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return false;
	if (!("content" in message) || !Array.isArray(message.content) || message.content.length === 0) return false;
	return message.content.every((item) => typeof item === "object" && item !== null && "type" in item && item.type === "toolCall");
}

function isAbortError(error: unknown): boolean {
	return error instanceof Error && (
		error.name === "AbortError"
		|| error.name === "ABORT_ERR"
		|| (error as Error & { code?: unknown }).code === "ABORT_ERR"
	);
}

export function prepareCodeModeHost(codeMode: CodeModeRegistration, ctx: ExtensionContext): void {
	void codeMode.prepare(ctx)?.catch((error: unknown) => {
		if (isAbortError(error)) return;
		ctx.ui.notify(`Code Mode host setup failed: ${error instanceof Error ? error.message : String(error)}`, "error");
	});
}

export function registerCodexEvents(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	tools: CodexToolRegistration,
	ui: CodexUiController,
	codeMode: CodeModeRegistration,
	proxyProvider: CodeModeProxyProviderRegistration,
): void {
	const { state, tracker, sessions } = runtime;
	const reserve = createCodexReserveController(pi);
	let activeContext: ExtensionContext | undefined;
	let pendingExtensionToolRefresh = false;
	const unregisterDeveloperMessageBroker = registerCodexDeveloperMessageBroker(
		pi,
		() => Boolean(
			activeContext &&
			supportsCodexDeveloperMessages(activeContext, state),
		),
		() => activeContext?.isIdle() ?? false,
	);
	const unregisterExtensionToolRefresh = onCodeModeExtensionToolsRefresh(
		pi,
		() => {
			if (!activeContext) return;
			if (!activeContext.isIdle()) {
				pendingExtensionToolRefresh = true;
				return;
			}
			pendingExtensionToolRefresh = false;
			syncAdapter(pi, activeContext, state);
		},
	);
	pi.events.on(REALTIME_VOICE_PROMPT_CHANNEL, (value) => {
		const report = parseRealtimeVoicePrompt(value);
		if (report) runtime.voice.setPrompt(report);
	});
	sessions.onSessionExit((sessionId) => tracker.recordSessionFinished(sessionId));

	pi.on("session_start", async (event, ctx) => {
		updateCodexPreparedIdleKickoff(pi, "session_reset");
		activeContext = ctx;
		pendingExtensionToolRefresh = false;
		state.notebookStatusMessageId = undefined;
		ui.invalidateUsageStatus();
		await runtime.lanVoice.stop(ctx);
		runtime.voice.resetContextAnnouncements();
		runtime.voice.resetSessionContext();
		initializeBashParser();
		runtime.resetTransport();
		state.developerMessages.clear();
		state.contextWindows.reset();
		state.contextKickoff.reset();
		state.contextTree.beginSession(pi);
		runtime.backgroundWidget.ctx = ctx;
		state.cwd = ctx.cwd;
		state.config = readEffectiveCodexConversionConfig({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
		state.executionMode = state.config.executionMode;
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		if (state.config.voiceFeaturesOnly) {
			clearApplyPatchRenderState();
			ui.clearBackgroundWidget();
			syncAdapter(pi, ctx, state);
			await runtime.configureDiagnostics(ctx);
			return;
		}
		sessions.setBaseEnv(runtime.execEnv());
		tracker.clear();
		clearApplyPatchRenderState();
		ui.renderBackgroundWidget();
		const plan = syncAdapter(pi, ctx, state);
		state.contextWindows.ensureInitialized(
			pi,
			ctx,
			plan.contextManagement,
		);
		await runtime.configureDiagnostics(ctx);
		void ui.refreshUsageStatus(ctx);
		prepareCodeModeHost(codeMode, ctx);
		if (event.reason === "startup") await maybeWarnLocalCheckoutVersion(ctx);
	});

	pi.on("thinking_level_select", (event, ctx) => {
		if (supportsCodexDeveloperMessages(ctx, state)) recordCodexReasoningUpdate(pi, ctx, runtime.projectContextMessages(ctx), event.previousLevel);
	});
	pi.on("model_select", async (_event, ctx) => {
		state.contextTree.handoff.reset();
		reserve.modelSelected(ctx);
		activeContext = ctx;
		pendingExtensionToolRefresh = false;
		ui.invalidateUsageStatus();
		runtime.resetTransport(ctx.sessionManager.getSessionId());
		state.cwd = ctx.cwd;
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		if (state.config.voiceFeaturesOnly) {
			ui.clearBackgroundWidget();
			syncAdapter(pi, ctx, state);
			await runtime.configureDiagnostics(ctx);
			return;
		}
		const plan = syncAdapter(pi, ctx, state);
		state.contextWindows.ensureInitialized(
			pi,
			ctx,
			plan.contextManagement,
		);
		await runtime.configureDiagnostics(ctx);
		void ui.refreshUsageStatus(ctx);
		prepareCodeModeHost(codeMode, ctx);
	});
	pi.on("session_before_switch", () => state.contextTree.handoff.active ? { cancel: true } : undefined);
	pi.on("session_before_fork", () => state.contextTree.handoff.active ? { cancel: true } : undefined);
	pi.on("session_before_tree", (event, ctx) => {
		if (state.contextTree.handoff.active) return { cancel: true };
		if (state.contextTree.archiving) return;
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		if (!plan.contextManagement || !event.preparation.userWantsSummary) return;
		return state.contextTree.handoff.prepare(pi, event, ctx, plan.contextManagementMode);
	});
	pi.on("session_tree", async (event, ctx) => {
		updateCodexPreparedIdleKickoff(pi, "session_reset");
		activeContext = ctx;
		pendingExtensionToolRefresh = false;
		const previousMode = state.executionMode;
		runtime.resetTransport(ctx.sessionManager.getSessionId());
		if (state.contextTree.handleSessionTree(event)) return;
		state.notebookStatusMessageId = undefined;
		if (previousMode === "notebook" || state.executionMode === "notebook") appendNotebookTreeEpoch(pi);
		await codeMode.shutdownHost();
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		const plan = syncAdapter(pi, ctx, state);
		state.contextWindows.ensureInitialized(
			pi,
			ctx,
			plan.contextManagement,
			event.newLeafId,
		);
		prepareCodeModeHost(codeMode, ctx);
		if (previousMode === "notebook" || state.executionMode === "notebook") {
			ctx.ui.notify("Notebook state reset after conversation-tree navigation", "info");
		}
	});

	pi.on("message_start", async (event) => {
		if (event.message.role === "user")
			runtime.voice.piUserMessage(event.message);
		if (event.message.role !== "toolResult" && !isToolCallOnlyAssistantMessage(event.message)) tracker.resetExplorationGroup();
	});
	pi.on("message_end", async (event) => {
		if (event.message.role === "assistant") {
			runtime.voice.finishAgentMessage(
				event.message,
				state.config.voice.forwardReasoningSummaries,
			);
			runtime.lanVoice.assistantMessage(event.message);
		}
	});
	pi.on("turn_end", (event, ctx) => {
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
		state.contextWindows.recordBudget(
			pi,
			ctx,
			plan.contextManagement,
		);
	});
	pi.on("message_update", async (event) => {
		runtime.voice.streamUpdate(event.assistantMessageEvent);
	});
	pi.on("tool_execution_start", async (event) => {
		if (event.toolName !== "exec_command") {
			tracker.resetExplorationGroup();
			return;
		}
		const command = commandArg(event.args);
		if (command) tracker.recordStart(event.toolCallId, command);
	});
	pi.on("tool_execution_end", async (event) => {
		if (event.toolName === "exec_command") tracker.recordEnd(event.toolCallId);
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		updateCodexPreparedIdleKickoff(pi, "session_reset");
		const failures: unknown[] = [];
		pendingExtensionToolRefresh = false;
		await runShutdownStep(failures, unregisterExtensionToolRefresh);
		await runShutdownStep(failures, () => ui.invalidateBackgroundWidget());
		await runShutdownStep(failures, () => runtime.lanVoice.stop(ctx));
		await runShutdownStep(failures, () => runtime.voice.stop({ announce: true }));
		// Voice's persisted end policy still needs the active developer broker.
		activeContext = undefined;
		await runShutdownStep(failures, unregisterDeveloperMessageBroker);
		await runShutdownStep(failures, () => runtime.shutdownTransport(ctx.sessionManager.getSessionId()));
		await runShutdownStep(failures, () => runtime.shutdownDiagnostics());
		await runShutdownStep(failures, () => sessions.shutdown());
		await runShutdownStep(failures, () => tools.shutdown());
		await runShutdownStep(failures, () => proxyProvider.shutdown());
		await runShutdownStep(failures, () => codeMode.shutdown());
		state.developerMessages.clear();
		state.contextWindows.reset();
		state.contextKickoff.reset();
		state.contextTree.reset();
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "Codex extension shutdown failed");
	});
	pi.on("input", async (event, ctx) => {
		const intercepted = state.contextTree.interceptInput(event);
		if (intercepted) return intercepted;
		if (event.streamingBehavior === undefined) {
			activeContext = ctx;
			pendingExtensionToolRefresh = false;
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
	});
	pi.on("before_agent_start", async (event, ctx) => {
		state.contextWindows.clearTurnNotes();
		state.contextTree.handoff.preparing(event.prompt);
		if (!state.config.voiceFeaturesOnly) await reserve.beforeTurn(ctx);
		runtime.autoReasoning.begin(ctx);
		const plan = resolveCodexRuntimePlanForState(ctx, state);
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
		if (plan.kind !== "notebook" || !["exec", "wait", "notebook"].every((name) => event.systemPromptOptions.selectedTools.includes(name))) return;
		// Count only persisted delivery, including snapshots archived by internal Tree rollover.
		if (state.notebookStatusMessageId && ctx.sessionManager.getEntries().some((entry) =>
			entry.type === "custom_message" && entry.customType === CODEX_DEVELOPER_MESSAGE_TYPE &&
			(entry.details as { id?: unknown } | undefined)?.id === state.notebookStatusMessageId)) return;
		let content: string;
		let failed = false;
		try {
			content = (await codeMode.notebookStatus(ctx)).message;
		} catch (error) {
			if (ctx.signal?.aborted) throw error;
			failed = true;
			content = `Notebook startup status unavailable: ${error instanceof Error ? error.message : String(error)}\nUse notebook diagnostics to inspect the failure before relying on retained state`;
		}
		state.notebookStatusMessageId = randomUUID();
		return { message: {
			customType: CODEX_DEVELOPER_MESSAGE_TYPE,
			content,
			display: failed,
			details: { protocol: 1, id: state.notebookStatusMessageId },
		} };
	});
	pi.on("agent_start", async (_event, ctx) => {
		state.contextWindows.beginTurn(ctx);
		updateCodexPreparedIdleKickoff(pi, "agent_start");
		state.contextTree.handoff.started(ctx);
		runtime.autoReasoning.begin(ctx);
		runtime.cancelCacheKeepalive();
		// Final serialization sees every extension's prompt and native tool edits.
		runtime.prepareTurn(ctx);
		runtime.voice.agentStarted();
		runtime.lanVoice.agentStarted();
	});
	pi.on("ui_prompt_start", async (event) => {
		runtime.lanVoice.uiPromptStarted(event.title);
	});
	pi.on("ui_prompt_end", async (_event, ctx) => {
		runtime.lanVoice.uiPromptEnded(!ctx.isIdle());
	});
	pi.on("agent_settled", async (_event, ctx) => {
		runtime.finishTurn();
		state.contextWindows.settleTurn(ctx);
		updateCodexPreparedIdleKickoff(pi, "agent_settled");
		flushCodexReasoningUpdates(pi, ctx);
		// Hybrid's asynchronous compact() aborts this run before its successor exists.
		const continuingWork = state.contextWindows.isHybridCompactionRunning()
			|| state.contextTree.rolloverPending || state.contextKickoff.pending;
		if (!continuingWork) runtime.autoReasoning.settle(ctx);
		// Reserve must capture the user's restored level, never a temporary Astra override.
		const quotaExhausted = !continuingWork && !state.config.voiceFeaturesOnly && await reserve.settled(ctx);
		let rolled = false;
		let continued = false;
		try {
			if (pendingExtensionToolRefresh) {
				pendingExtensionToolRefresh = false;
				syncAdapter(pi, ctx, state);
			}
			state.codexTurnState.reset();
			runtime.voice.settleTurn();
			runtime.lanVoice.agentSettled();
			if (!state.config.voiceFeaturesOnly) void ui.refreshUsageStatus(ctx);
			rolled = await state.contextTree.settle(pi, ctx);
			if (rolled) runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
			state.contextTree.handoff.settled(ctx);
			continued = state.contextKickoff.continue(pi, ctx);
		} finally {
			if (continuingWork && !continued && !state.contextWindows.isHybridCompactionRunning()) runtime.autoReasoning.settle(ctx);
		}
		if (!rolled && !continued && !quotaExhausted && !state.contextWindows.isHybridCompactionRunning()) runtime.armCacheKeepalive(ctx);
	});
	pi.on("cache_warming_decision", (_event, ctx) => {
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		// These routes cannot honor Pi's one-token cap and must not advance the live response chain.
		if (plan.codexTransport || plan.transport === "responses-lite") return { action: "stop" };
		return undefined;
	});
	pi.on("before_provider_request", async (event, ctx) => {
		state.cwd = ctx.cwd;
		return rewriteCodexProviderRequest(event.payload, ctx, state);
	});
	pi.on("before_provider_headers", (event, ctx) => {
		rewriteCodexProviderHeaders(event.headers, ctx, state);
	});
	pi.on("session_before_compact", async (event, ctx) => {
		if (state.contextTree.handoff.active) return { cancel: true };
		// Summaries can share the model/session routing; keep the live checkpoint.
		runtime.finishTurn();
		state.cwd = ctx.cwd;
		const plan = resolveCodexRuntimePlanForState(
			ctx,
			state,
		);
		const contextManagementResult = plan.contextManagement
			? state.contextWindows.prepareCompaction(
				event,
				plan.contextManagementMode,
				plan.contextManagementHybrid,
			)
			: undefined;
		if (contextManagementResult && "cancel" in contextManagementResult)
			return contextManagementResult;
		if (event.reason !== "manual") runtime.voice.announceContextTransition(event.reason);
		const nativeCompaction = plan.nativeCompaction;
		if (nativeCompaction || plan.contextManagement)
			runtime.voice.compactionStarted();
		try {
			await codeMode.checkpointNotebook();
		} catch (error) {
			ctx.ui.notify(`Notebook checkpoint before compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
		if (contextManagementResult) return contextManagementResult;
		if (!nativeCompaction) return undefined;
		try {
			const result = await handleCodexSessionBeforeCompact(
				event,
				ctx,
				state,
				pi,
			);
			if (!result?.compaction) runtime.voice.compactionFinished();
			return result;
		} catch (error) {
			runtime.voice.compactionFinished();
			throw error;
		}
	});
	pi.on("session_compact_failed", async (event, ctx) => {
		if (state.contextWindows.isHybridCompactionRunning()) runtime.autoReasoning.settle(ctx);
		state.pendingPiCompactionNativeWindow = undefined;
		runtime.voice.compactionFinished();
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		const reuseNotes = state.contextWindows.finishManualCheckpointRequest(
			pi, ctx, event, plan.contextManagement && !plan.contextManagementHybrid,
		);
		if (!reuseNotes) return;
		try {
			const rolled = plan.contextManagementMode === "tree"
				? state.contextTree.schedule(ctx, { triggerTurn: false }) && await state.contextTree.settle(pi, ctx)
				: await state.contextKickoff.startWindow(pi, ctx, {
					triggerTurn: false,
					mode: plan.contextManagementMode,
					trimPreviousWindow: true,
				});
			if (rolled) runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
			else if (plan.contextManagementMode !== "tree")
				ctx.ui.notify("Context rollover did not start", "warning");
		} catch (error) {
			ctx.ui.notify(`Context rollover failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		}
	});
	pi.on("session_compact", async (event, ctx) => {
		try {
			runtime.voice.resetContextAnnouncements();
			state.pendingPiCompactionNativeWindow = undefined;
			state.contextWindows.recordCompaction(event.compactionEntry.details);
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			let treeRolloverScheduled = false;
			const contextCompaction =
				event.fromExtension &&
				isContextWindowCompactionDetails(event.compactionEntry.details);
			const compactionEntry = findLatestCompactionEntry(ctx.sessionManager.getBranch());
			if (event.fromExtension && compactionEntry && isNativeCompactionDetails(compactionEntry.details)) {
				const details = compactionEntry.details;
				// Presentation entries persist and render without entering Pi's turn queue or LLM context.
				pi.appendEntry<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, {
					content: hasPortableNativeCompactionSummary(compactionEntry)
						? NATIVE_COMPACTION_PORTABLE_DISPLAY_TEXT
						: NATIVE_COMPACTION_DISPLAY_TEXT,
					compactionEntryId: compactionEntry.id,
				});
				if (details.strategy === NATIVE_COMPACTION_STRATEGY && details.usage) {
					pi.appendEntry<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, {
						content: formatCompactionUsage(details.usage),
						compactionEntryId: compactionEntry.id,
						kind: "usage",
					});
				}
			}
			// Overflow compaction keeps the current window and resumes from its checkpoint.
			if (plan.contextManagementHybrid && event.reason !== "overflow") {
				if (plan.contextManagementMode === "tree" && compactionEntry) {
					const requested = state.contextWindows.isHybridCompactionRunning();
					treeRolloverScheduled = state.contextTree.schedule(ctx, {
						compactionEntryId: compactionEntry.id,
						triggerTurn: requested,
					});
					if (event.reason === "manual" && !requested) {
						await state.contextTree.settle(pi, ctx);
						treeRolloverScheduled = false;
					}
				} else await state.contextWindows.completeHybridCompaction(pi, ctx, plan.contextManagementMode);
			}
			if (!treeRolloverScheduled) {
				runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
				// Tool-requested rollover appends its marker in onComplete; do not prewarm the old window.
				if (!state.contextWindows.isHybridCompactionRunning() && !state.contextKickoff.pending)
					await runtime.startCompactionPrewarm(ctx);
			}
			// Explicit Hybrid rollover refreshes at its window boundary; overflow stays here.
			if (!contextCompaction && (!plan.contextManagementHybrid || event.reason === "overflow"))
				await runtime.voice.refreshRealtimeContext(ctx, state.config);
		} finally {
			runtime.voice.compactionFinished();
		}
	});
	pi.on("context", async (event, ctx) => {
		let messages = runtime.projectContextMessages(ctx, event.messages);
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
	});
}

async function runShutdownStep(failures: unknown[], action: () => unknown): Promise<void> {
	try {
		await action();
	} catch (error) {
		failures.push(error);
	}
}
