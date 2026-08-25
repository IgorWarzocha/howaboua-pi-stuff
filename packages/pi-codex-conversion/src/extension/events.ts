import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { syncAdapter } from "../adapter/activation/activation.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, NATIVE_COMPACTION_STRATEGY, type NativeCompactionDisplayEntry, type NativeCompactionUsage } from "../adapter/compaction/types.ts";
import { findLatestCompactionEntry } from "../adapter/compaction/details-store.ts";
import { handleCodexSessionBeforeCompact } from "../adapter/compaction/compaction.ts";
import { rewriteCodexProviderHeaders, rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.ts";
import { hasNoSkillsFlag } from "../adapter/prompt/skills.ts";
import { extractPiPromptSkills, resolvePromptSkills } from "../prompt/build-system-prompt.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import { maybeWarnLocalCheckoutVersion } from "../adapter/local-version-warning.ts";
import { clearApplyPatchRenderState } from "../tools/apply-patch/tool.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { parseRealtimeVoicePrompt, REALTIME_VOICE_PROMPT_CHANNEL } from "../realtime-voice.ts";
import { initializeBashParser } from "../shell/bash.ts";
import { prepareVoiceDelegation } from "../voice/delegation-preflight.ts";
import { appendNotebookTreeEpoch } from "../tools/notebook-mode/session-identity.ts";
import { formatCompactionCacheDiagnostic } from "../adapter/compaction/diagnostics.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";

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
	pi.events.on(REALTIME_VOICE_PROMPT_CHANNEL, (value) => {
		const report = parseRealtimeVoicePrompt(value);
		if (report) runtime.voice.setPrompt(report);
	});
	runtime.voice.setDelegationPreflight((ctx, signal) => prepareVoiceDelegation(runtime, codeMode, ctx, signal));
	sessions.onSessionExit((sessionId) => tracker.recordSessionFinished(sessionId));

	pi.on("session_start", async (event, ctx) => {
		ui.invalidateUsageStatus();
		await runtime.lanVoice.stop(ctx);
		runtime.voice.resetContextAnnouncements();
		runtime.voice.resetSessionContext();
		initializeBashParser();
		runtime.resetTransport();
		runtime.backgroundWidget.ctx = ctx;
		state.cwd = ctx.cwd;
		state.config = readEffectiveCodexConversionConfig({
			cwd: ctx.cwd,
			projectTrusted: ctx.isProjectTrusted(),
		});
		state.weeklyUsageLeft = undefined;
		state.executionMode = state.config.executionMode;
		state.activeProviderSystemPrompt = undefined;
		state.voiceSystemPromptOverride = undefined;
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		if (state.config.voiceFeaturesOnly) {
			clearApplyPatchRenderState();
			tools.ensureOptionalTools();
			ui.clearBackgroundWidget();
			syncAdapter(pi, ctx, state);
			await runtime.configureDiagnostics(ctx);
			return;
		}
		sessions.setBaseEnv(runtime.execEnv());
		tracker.clear();
		clearApplyPatchRenderState();
		tools.ensureOptionalTools();
		ui.renderBackgroundWidget();
		syncAdapter(pi, ctx, state);
		await runtime.configureDiagnostics(ctx);
		void ui.refreshUsageStatus(ctx);
		prepareCodeModeHost(codeMode, ctx);
		if (!state.config.prompt.heavySystemPromptOverwrite)
			void runtime.startPrewarm(ctx, codeMode.refreshPromptTools(ctx.getSystemPrompt(), ctx));
		if (event.reason === "startup") await maybeWarnLocalCheckoutVersion(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		ui.invalidateUsageStatus();
		runtime.resetTransport(ctx.sessionManager.getSessionId());
		state.cwd = ctx.cwd;
		state.activeProviderSystemPrompt = undefined;
		state.voiceSystemPromptOverride = undefined;
		state.weeklyUsageLeft = undefined;
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		if (state.config.voiceFeaturesOnly) {
			tools.ensureOptionalTools();
			ui.clearBackgroundWidget();
			syncAdapter(pi, ctx, state);
			await runtime.configureDiagnostics(ctx);
			return;
		}
		tools.ensureOptionalTools();
		syncAdapter(pi, ctx, state);
		await runtime.configureDiagnostics(ctx);
		void ui.refreshUsageStatus(ctx);
		prepareCodeModeHost(codeMode, ctx);
		if (!state.config.prompt.heavySystemPromptOverwrite)
			void runtime.startPrewarm(ctx, codeMode.refreshPromptTools(ctx.getSystemPrompt(), ctx));
	});
	pi.on("session_tree", async (_event, ctx) => {
		const previousMode = state.executionMode;
		state.activeProviderSystemPrompt = undefined;
		state.voiceSystemPromptOverride = undefined;
		runtime.resetTransport(ctx.sessionManager.getSessionId());
		if (previousMode === "notebook" || state.executionMode === "notebook") appendNotebookTreeEpoch(pi);
		await codeMode.shutdownHost();
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		syncAdapter(pi, ctx, state);
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
	pi.on("message_update", async (event) => {
		const update = event.assistantMessageEvent;
		if (update.type === "text_delta" && typeof update.delta === "string")
			runtime.voice.streamDelta(update.delta);
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
		const failures: unknown[] = [];
		await runShutdownStep(failures, () => ui.invalidateBackgroundWidget());
		await runShutdownStep(failures, () => runtime.lanVoice.stop(ctx));
		await runShutdownStep(failures, () => runtime.voice.stop({ announce: true }));
		await runShutdownStep(failures, () => runtime.shutdownTransport(ctx.sessionManager.getSessionId()));
		await runShutdownStep(failures, () => runtime.shutdownDiagnostics());
		await runShutdownStep(failures, () => sessions.shutdown());
		await runShutdownStep(failures, () => proxyProvider.shutdown());
		await runShutdownStep(failures, () => codeMode.shutdown());
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "Codex extension shutdown failed");
	});
	pi.on("input", async (event) => {
		if (event.streamingBehavior === undefined) state.codexTurnState.beginTurn();
		if (event.source !== "extension")
			runtime.voice.piInput(event.text, event.streamingBehavior);
	});
	pi.on("before_agent_start", async (event, ctx) => {
		const systemPrompt = event.systemPrompt;
		state.voiceSystemPromptOverride = undefined;
		if (!isAdapterRuntime(resolveCodexRuntimePlanForState(ctx, state))) {
			state.activeProviderSystemPrompt = undefined;
			state.pendingActiveProviderPromptCapture = false;
			return undefined;
		}
		const skills = resolvePromptSkills(event.systemPromptOptions?.skills, hasNoSkillsFlag() ? [] : state.promptSkills);
		const codexSystemPrompt = runtime.codexSystemPrompt(systemPrompt, ctx, skills, event.systemPromptOptions);
		state.activeProviderSystemPrompt = codexSystemPrompt;
		state.pendingActiveProviderPromptCapture = true;
		await runtime.waitForPrewarm(ctx, codexSystemPrompt);
		return {
			systemPrompt: codexSystemPrompt,
		};
	});
	pi.on("agent_start", async () => {
		runtime.cancelCacheKeepalive();
		runtime.voice.agentStarted();
		runtime.lanVoice.agentStarted();
	});
	pi.on("agent_settled", async (_event, ctx) => {
		state.pendingActiveProviderPromptCapture = false;
		state.voiceSystemPromptOverride = undefined;
		state.codexTurnState.reset();
		runtime.voice.settleTurn();
		runtime.lanVoice.agentSettled();
		if (!state.config.voiceFeaturesOnly) void ui.refreshUsageStatus(ctx);
		runtime.armCacheKeepalive(ctx);
	});
	pi.on("before_provider_request", async (event, ctx) => {
		state.cwd = ctx.cwd;
		return rewriteCodexProviderRequest(event.payload, ctx, state);
	});
	pi.on("before_provider_headers", (event, ctx) => {
		rewriteCodexProviderHeaders(event.headers, ctx, state);
	});
	pi.on("session_before_compact", async (event, ctx) => {
		state.cwd = ctx.cwd;
		if (event.reason !== "manual") runtime.voice.announceCompactionStart(event.reason);
		const nativeCompaction = resolveCodexRuntimePlanForState(
			ctx,
			state,
		).nativeCompaction;
		if (nativeCompaction) runtime.voice.compactionStarted();
		try {
			await codeMode.checkpointNotebook();
		} catch (error) {
			ctx.ui.notify(`Notebook checkpoint before compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
		}
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
	pi.on("session_compact_failed", async () => {
		state.pendingPiCompactionNativeWindow = undefined;
		runtime.voice.compactionFinished();
	});
	pi.on("session_compact", async (event, ctx) => {
		try {
			runtime.voice.resetContextAnnouncements();
			state.pendingPiCompactionNativeWindow = undefined;
			let nativeCompaction = false;
			const compactionEntry = findLatestCompactionEntry(ctx.sessionManager.getBranch());
			if (event.fromExtension && compactionEntry && isNativeCompactionDetails(compactionEntry.details)) {
				const details = compactionEntry.details;
				nativeCompaction = true;
				// Presentation entries persist and render without entering Pi's turn queue or LLM context.
				pi.appendEntry<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, {
					content: NATIVE_COMPACTION_DISPLAY_TEXT,
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
			const postCompactionPrompt = codeMode.refreshPromptTools(
				state.activeProviderSystemPrompt ?? ctx.getSystemPrompt(),
				ctx,
			);
			state.activeProviderSystemPrompt = postCompactionPrompt;
			runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
			await (nativeCompaction
				? runtime.startCompactionPrewarm(ctx)
				: runtime.startPrewarm(ctx, postCompactionPrompt, true));
		} finally {
			runtime.voice.compactionFinished();
		}
	});
	pi.on("context", async (event) => {
		const messages = event.messages.filter((message) => !isProviderContextExcludedMessage(message));
		if (state.config.voiceFeaturesOnly) return { messages };
		return { messages };
	});
}

async function runShutdownStep(failures: unknown[], action: () => unknown): Promise<void> {
	try {
		await action();
	} catch (error) {
		failures.push(error);
	}
}
