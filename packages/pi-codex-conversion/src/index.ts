import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getDefaultCodexRuntimeShell } from "./adapter/runtime-shell.ts";
import { createExecCommandTracker } from "./tools/exec-command-state.ts";
import { registerExecCommandTool } from "./tools/exec-command-tool.ts";
import { createExecSessionManager } from "./tools/exec-session-manager.ts";
import { registerOpenAICodexCustomProvider } from "./providers/openai-codex-custom-provider.ts";
import { buildCodexSystemPrompt, extractPiPromptSkills, resolvePromptSkills } from "./prompt/build-system-prompt.ts";
import { registerWriteStdinTool } from "./tools/write-stdin-tool.ts";
import { ensureBundledPathToolsOnPath } from "./tools/path-tools-binary.ts";
import { readCodexConversionConfig } from "./adapter/config.ts";
import { syncAdapter, mergeAdapterTools, restoreTools, stripAdapterTools, shouldUseCodexAdapter } from "./adapter/activation.ts";
import { rewriteCodexProviderRequest } from "./adapter/provider-request.ts";
import { handleCodexSessionBeforeCompact } from "./adapter/compaction.ts";
import { isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT } from "./adapter/types.ts";
import { isAdapterContextExcludedCustomMessage } from "./adapter/context-filter.ts";
import { getCodexSkillPaths, hasNoSkillsFlag } from "./adapter/skills.ts";
import type { AdapterState } from "./adapter/state.ts";
import { registerCodexCommand } from "./codex-settings/command.ts";
import { applyCodexContextBudgetToModel, readPiCompactionReserveTokens } from "./adapter/codex-context-budget.ts";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget, type BackgroundBashWidgetState } from "./tools/background-bash-widget.ts";

function getCommandArg(args: unknown): string | undefined {
	if (!args || typeof args !== "object" || !("cmd" in args) || typeof args.cmd !== "string") {
		return undefined;
	}
	return args.cmd;
}

function isToolCallOnlyAssistantMessage(message: unknown): boolean {
	if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") {
		return false;
	}
	if (!("content" in message) || !Array.isArray(message.content) || message.content.length === 0) {
		return false;
	}
	return message.content.every((item) => typeof item === "object" && item !== null && "type" in item && item.type === "toolCall");
}

export default function codexConversion(pi: ExtensionAPI) {
	ensureBundledPathToolsOnPath();
	const tracker = createExecCommandTracker();
	const state: AdapterState = { enabled: false, cwd: process.cwd(), promptSkills: [], config: readCodexConversionConfig() };
	const sessions = createExecSessionManager();
	const backgroundBashWidget: BackgroundBashWidgetState = { folded: true };
	let backgroundWidgetRenderTimer: ReturnType<typeof setTimeout> | undefined;

	function ensureCodexContextBudgetModel(ctx: { model: Model<any> | undefined }): void {
		applyCodexContextBudgetToModel(ctx.model, state);
	}

	registerOpenAICodexCustomProvider(pi, {
		getCurrentCwd: () => state.cwd,
		getConfig: () => state.config.openai,
	});
	registerExecCommandTool(pi, tracker, sessions);
	registerWriteStdinTool(pi, sessions);
	function clearBackgroundShellWidget(): void {
		if (backgroundWidgetRenderTimer) {
			clearTimeout(backgroundWidgetRenderTimer);
			backgroundWidgetRenderTimer = undefined;
		}
		backgroundBashWidget.ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
	}

	function renderBackgroundShellWidget(ctx = backgroundBashWidget.ctx): void {
		if (!ctx) return;
		if (!state.config.ui.backgroundShellWidget) {
			clearBackgroundShellWidget();
			return;
		}
		renderBackgroundBashWidget(ctx, backgroundBashWidget, sessions);
	}

	function applyConfig(config: typeof state.config): void {
		if (!config.ui.backgroundShellWidget) clearBackgroundShellWidget();
		else renderBackgroundShellWidget();
	}

	registerCodexCommand(pi, state, applyConfig, { sessions, widget: backgroundBashWidget });
	registerBackgroundBashWidgetShortcuts(pi, backgroundBashWidget, sessions, state.config.ui, () => state.config.ui.backgroundShellWidget);

	pi.registerMessageRenderer(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, (message, _options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[compaction]")), 0, 0));
		const content = typeof message.content === "string" ? message.content : NATIVE_COMPACTION_DISPLAY_TEXT;
		box.addChild(new Text(`\n${theme.fg("customMessageText", content)}`, 0, 0));
		const render = box.render.bind(box);
		box.render = (width) => render(width).map((line) => truncateToWidth(line, width, ""));
		return box;
	});

	sessions.onSessionChange((reason) => {
		if (backgroundBashWidget.ctx && state.config.ui.backgroundShellWidget) {
			if (reason === "output") {
				if (backgroundWidgetRenderTimer) return;
				backgroundWidgetRenderTimer = setTimeout(() => {
					backgroundWidgetRenderTimer = undefined;
					if (backgroundBashWidget.ctx) renderBackgroundShellWidget(backgroundBashWidget.ctx);
				}, 250);
				return;
			}
			if (backgroundWidgetRenderTimer) {
				clearTimeout(backgroundWidgetRenderTimer);
				backgroundWidgetRenderTimer = undefined;
			}
			renderBackgroundShellWidget(backgroundBashWidget.ctx);
		}
	});

	sessions.onSessionExit((sessionId) => {
		tracker.recordSessionFinished(sessionId);
	});

	pi.on("session_start", async (_event, ctx) => {
		backgroundBashWidget.ctx = ctx;
		state.cwd = ctx.cwd;
		state.config = readCodexConversionConfig();
		state.codexContextBudgetReserveTokens = readPiCompactionReserveTokens(ctx.cwd);
		ensureCodexContextBudgetModel(ctx);
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		tracker.clear();
		renderBackgroundShellWidget(ctx);
		syncAdapter(pi, ctx, state);
	});

	pi.on("resources_discover", async (event) => {
		if (hasNoSkillsFlag()) return undefined;
		const skillPaths = getCodexSkillPaths(event.cwd);
		return skillPaths.length > 0 ? { skillPaths } : undefined;
	});

	pi.on("model_select", async (_event, ctx) => {
		state.cwd = ctx.cwd;
		state.codexContextBudgetReserveTokens = readPiCompactionReserveTokens(ctx.cwd);
		ensureCodexContextBudgetModel(ctx);
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		syncAdapter(pi, ctx, state);
	});

	pi.on("message_start", async (event) => {
		if (event.message.role === "toolResult") return;
		if (isToolCallOnlyAssistantMessage(event.message)) return;
		tracker.resetExplorationGroup();
	});

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName !== "exec_command") {
			tracker.resetExplorationGroup();
			return;
		}
		const command = getCommandArg(event.args);
		if (!command) return;
		tracker.recordStart(event.toolCallId, command);
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName !== "exec_command") return;
		tracker.recordEnd(event.toolCallId);
	});

	pi.on("session_shutdown", async () => {
		clearBackgroundShellWidget();
		backgroundBashWidget.ctx = undefined;
		sessions.shutdown();
	});

	pi.on("before_agent_start", async (event, ctx) => {
		if (!shouldUseCodexAdapter(ctx, state.config)) {
			return undefined;
		}
		const skills = resolvePromptSkills(event.systemPromptOptions?.skills, hasNoSkillsFlag() ? [] : state.promptSkills);
		return {
			systemPrompt: buildCodexSystemPrompt(event.systemPrompt, {
				skills,
				shell: getDefaultCodexRuntimeShell(),
				tools: state.config.tools,
			}),
		};
	});

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
		pi.sendMessage(
			{
				customType: NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
				content: NATIVE_COMPACTION_DISPLAY_TEXT,
				display: true,
				details: { compactionEntryId: event.compactionEntry.id },
			},
			{ triggerTurn: false },
		);
	});

	pi.on("context", async (event) => ({ messages: event.messages.filter((message) => !isAdapterContextExcludedCustomMessage(message)) }));
}

export { getCodexSkillPaths, mergeAdapterTools, restoreTools, stripAdapterTools };
