import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { rewriteCodexProviderHeaders, rewriteCodexProviderRequest, supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import type { CodeModeProxyProviderRegistration } from "../providers/code-mode-proxy-provider.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { parseRealtimeVoicePrompt, REALTIME_VOICE_PROMPT_CHANNEL } from "../realtime-voice.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import type { CodexToolRegistration } from "./tools.ts";
import type { CodexUiController } from "./ui.ts";
import { recordCodexReasoningUpdate } from "../adapter/reasoning-updates.ts";
import { createCodexReserveController } from "../codex-usage/reserve.ts";
import { recordCodexProxyMessage } from "../codex-usage/ledger-store.ts";
import { createCodexSessionLifecycle } from "./session-lifecycle.ts";
import { createCodexTurnLifecycle } from "./turn-lifecycle.ts";
import { createCodexCompactionLifecycle } from "./compaction-lifecycle.ts";

function commandArg(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("cmd" in args) || typeof args.cmd !== "string") return undefined;
	return args.cmd;
}

function isToolCallOnlyAssistantMessage(message: unknown): boolean {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") return false;
	if (!("content" in message) || !Array.isArray(message.content) || message.content.length === 0) return false;
	return message.content.every((item) => typeof item === "object" && item !== null && "type" in item && item.type === "toolCall");
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
	const session = createCodexSessionLifecycle(pi, runtime, tools, ui, codeMode, proxyProvider, reserve.modelSelected);
	const turn = createCodexTurnLifecycle(pi, runtime, ui, codeMode, reserve, session);
	const compaction = createCodexCompactionLifecycle(pi, runtime, codeMode, turn.startManualNotesWindow, turn.refreshNotebookStatus);
	pi.events.on(REALTIME_VOICE_PROMPT_CHANNEL, (value) => {
		const report = parseRealtimeVoicePrompt(value);
		if (report) runtime.voice.setPrompt(report);
	});
	sessions.onSessionExit((sessionId) => tracker.recordSessionFinished(sessionId));

	pi.on("session_start", session.start);
	pi.on("thinking_level_select", (event, ctx) => {
		if (supportsCodexDeveloperMessages(ctx, state)) recordCodexReasoningUpdate(pi, ctx, runtime.projectContextMessages(ctx), event.previousLevel);
	});
	pi.on("model_select", session.modelSelected);
	pi.on("session_before_switch", session.beforeSwitch);
	pi.on("session_before_fork", session.beforeFork);
	pi.on("session_before_tree", session.beforeTree);
	pi.on("session_tree", session.tree);
	pi.on("message_start", async (event) => {
		if (event.message.role === "user")
			runtime.voice.piUserMessage(event.message);
		if (event.message.role !== "toolResult" && !isToolCallOnlyAssistantMessage(event.message)) tracker.resetExplorationGroup();
	});
	pi.on("message_end", async (event, ctx) => {
		if (event.message.role === "assistant") {
			runtime.voice.finishAgentMessage(
				event.message,
				state.config.voice.forwardReasoningSummaries,
			);
			runtime.lanVoice.assistantMessage(event.message);
			await recordCodexProxyMessage(event.message, ctx.modelRegistry);
		}
	});
	pi.on("turn_end", turn.turnEnded);
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
	pi.on("session_shutdown", session.shutdown);
	pi.on("input", turn.input);
	pi.on("before_agent_start", turn.beforeAgentStart);
	pi.on("agent_start", turn.agentStarted);
	pi.on("ui_prompt_start", async (event) => {
		runtime.lanVoice.uiPromptStarted(event.title);
	});
	pi.on("ui_prompt_end", async (_event, ctx) => {
		runtime.lanVoice.uiPromptEnded(!ctx.isIdle());
	});
	pi.on("agent_settled", turn.agentSettled);
	pi.on("agent_before_settle", turn.agentBeforeSettle);
	pi.on("cache_warming_decision", (_event, ctx) => {
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		// These routes cannot honor Pi's one-token cap and must not advance the live response chain.
		if (plan.codexTransport || plan.transport === "responses-lite") return { action: "stop" };
		return undefined;
	});
	pi.on("before_provider_request", async (event, ctx) => {
		state.cwd = ctx.cwd;
		return rewriteCodexProviderRequest(event.payload, ctx, state, pi.getSettings().images?.blockImages);
	});
	pi.on("before_provider_headers", (event, ctx) => {
		rewriteCodexProviderHeaders(event.headers, ctx, state);
	});
	pi.on("session_before_compact", compaction.beforeCompact);
	pi.on("session_compact_failed", compaction.failed);
	pi.on("session_compact", compaction.compacted);
	pi.on("context_with_system", turn.contextWithSystem);
}
