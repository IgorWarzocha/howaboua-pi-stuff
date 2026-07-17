import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { readCodexConversionConfig } from "../adapter/activation/config.ts";
import { shouldUseCodexAdapter, syncAdapter } from "../adapter/activation/activation.ts";
import { handleCodexSessionBeforeCompact } from "../adapter/compaction/compaction.ts";
import { isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT } from "../adapter/compaction/types.ts";
import { rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { isAdapterContextExcludedCustomMessage } from "../adapter/prompt/context-filter.ts";
import { hasNoSkillsFlag } from "../adapter/prompt/skills.ts";
import { extractPiPromptSkills, resolvePromptSkills } from "../prompt/build-system-prompt.ts";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages } from "../providers/openai-responses/shared.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import { maybeWarnLocalCheckoutVersion } from "../adapter/local-version-warning.ts";
import { clearApplyPatchRenderState } from "../tools/apply-patch/tool.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { clearPathApplyPatchPreviewStates } from "../tools/path/apply-patch-preview.ts";
import { buildRecentWebSearchInput } from "../tools/web-run/tool.ts";
import { initializeBashParser } from "../shell/bash.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";

function commandArg(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("cmd" in args) || typeof args.cmd !== "string") return undefined;
	return args.cmd;
}

function isToolCallOnlyAssistantMessage(message: unknown): boolean {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return false;
	if (!("content" in message) || !Array.isArray(message.content) || message.content.length === 0) return false;
	return message.content.every((item) => typeof item === "object" && item !== null && "type" in item && item.type === "toolCall");
}

function responsesContext(messages: unknown[]): Context {
	// Pi context events may include registered custom messages. The Responses
	// converter owns their normalization through transformMessages().
	return { messages: messages as Context["messages"] };
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
	sessions.onSessionExit((sessionId) => tracker.recordSessionFinished(sessionId));

	pi.on("session_start", async (event, ctx) => {
		initializeBashParser();
		runtime.resetTransport();
		runtime.backgroundWidget.ctx = ctx;
		state.cwd = ctx.cwd;
		state.config = readCodexConversionConfig();
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		sessions.setBaseEnv(runtime.bundledPathToolsEnv());
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		tracker.clear();
		clearApplyPatchRenderState();
		clearPathApplyPatchPreviewStates();
		tools.ensureOptionalTools();
		ui.renderBackgroundWidget();
		syncAdapter(pi, ctx, state);
		prepareCodeModeHost(codeMode, ctx);
		void runtime.startPrewarm(ctx);
		if (event.reason === "startup") await maybeWarnLocalCheckoutVersion(ctx);
	});

	pi.on("model_select", async (_event, ctx) => {
		runtime.resetTransport(ctx.sessionManager.getSessionId());
		state.cwd = ctx.cwd;
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		proxyProvider.applyConfig(state.config, ctx.modelRegistry);
		tools.ensureOptionalTools();
		syncAdapter(pi, ctx, state);
		prepareCodeModeHost(codeMode, ctx);
		void runtime.startPrewarm(ctx);
	});

	pi.on("message_start", async (event) => {
		if (event.message.role !== "toolResult" && !isToolCallOnlyAssistantMessage(event.message)) tracker.resetExplorationGroup();
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
		try {
			runtime.shutdownTransport(ctx.sessionManager.getSessionId());
			ui.clearBackgroundWidget();
			runtime.backgroundWidget.ctx = undefined;
			sessions.shutdown();
		} finally {
			try {
				proxyProvider.shutdown();
			} finally {
				await codeMode.shutdown();
			}
		}
	});
	pi.on("input", async (event) => {
		if (event.streamingBehavior === undefined) state.codexTurnState.beginTurn();
	});
	pi.on("before_agent_start", async (event, ctx) => {
		if (!shouldUseCodexAdapter(ctx, state.config)) return undefined;
		const skills = resolvePromptSkills(event.systemPromptOptions?.skills, hasNoSkillsFlag() ? [] : state.promptSkills);
		await runtime.waitForPrewarm(ctx, event.systemPrompt);
		return { systemPrompt: runtime.codexSystemPrompt(event.systemPrompt, ctx, skills) };
	});
	pi.on("agent_settled", async () => state.codexTurnState.reset());
	pi.on("before_provider_request", async (event, ctx) => {
		state.cwd = ctx.cwd;
		return rewriteCodexProviderRequest(event.payload, ctx, state);
	});
	pi.on("session_before_compact", async (event, ctx) => {
		state.cwd = ctx.cwd;
		return handleCodexSessionBeforeCompact(event, ctx, state, pi);
	});
	pi.on("session_compact", async (event) => {
		state.pendingPiCompactionNativeWindow = undefined;
		if (!event.fromExtension || !isNativeCompactionDetails(event.compactionEntry.details)) return;
		pi.sendMessage({
			customType: NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
			content: NATIVE_COMPACTION_DISPLAY_TEXT,
			display: true,
			details: { compactionEntryId: event.compactionEntry.id },
		}, { triggerTurn: false });
	});
	pi.on("context", async (event, ctx) => {
		const messages = event.messages.filter((message) => !isAdapterContextExcludedCustomMessage(message));
		runtime.latestRecentWebSearchInput = ctx.model
			? buildRecentWebSearchInput(convertResponsesMessages(ctx.model, responsesContext(messages), CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false }))
			: undefined;
		return { messages };
	});
}
