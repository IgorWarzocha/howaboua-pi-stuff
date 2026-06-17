import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getDefaultCodexRuntimeShell } from "./adapter/prompt/runtime-shell.ts";
import { clearApplyPatchRenderState, registerApplyPatchTool } from "./tools/apply-patch/tool.ts";
import { clearPathApplyPatchPreviewStates } from "./tools/path/apply-patch-preview.ts";
import { createExecCommandTracker } from "./tools/exec/command-state.ts";
import { registerExecCommandTool } from "./tools/exec/command-tool.ts";
import { createExecSessionManager } from "./tools/exec/session-manager.ts";
import { registerOpenAICodexCustomProvider } from "./providers/openai-codex-custom-provider.ts";
import { registerImageGenerationTool } from "./tools/imagegen/tool.ts";
import { buildCodexSystemPrompt, extractPiPromptSkills, resolvePromptSkills } from "./prompt/build-system-prompt.ts";
import { registerViewImageTool, supportsViewImageInputs } from "./tools/view-image/tool.ts";
import { buildRecentWebSearchInput, registerWebSearchTool } from "./tools/web-run/tool.ts";
import { registerWriteStdinTool } from "./tools/exec/write-stdin-tool.ts";
import { createBundledPathToolsEnv } from "./tools/path/binary.ts";
import { readCodexConversionConfig } from "./adapter/activation/config.ts";
import { syncAdapter, mergeAdapterTools, restoreTools, stripAdapterTools, shouldUseCodexAdapter } from "./adapter/activation/activation.ts";
import { rewriteCodexProviderRequest } from "./adapter/provider-request.ts";
import { handleCodexSessionBeforeCompact } from "./adapter/compaction/compaction.ts";
import { isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT } from "./adapter/compaction/types.ts";
import { isAdapterContextExcludedCustomMessage } from "./adapter/prompt/context-filter.ts";
import { getCodexSkillPaths, hasNoSkillsFlag } from "./adapter/prompt/skills.ts";
import type { AdapterState } from "./adapter/activation/state.ts";
import { registerCodexCommand } from "./ui/settings/command.ts";
import { WEB_SEARCH_TOOL_NAME } from "./adapter/activation/tool-set.ts";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget, type BackgroundBashWidgetState } from "./ui/background-bash-widget.ts";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages } from "./providers/openai-responses/shared.ts";
import type { ResponseInput } from "openai/resources/responses/responses.js";

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
	const tracker = createExecCommandTracker();
	const state: AdapterState = { enabled: false, cwd: process.cwd(), promptSkills: [], config: readCodexConversionConfig() };
	const sessions = createExecSessionManager({ env: createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel }) });
	const backgroundBashWidget: BackgroundBashWidgetState = { folded: true };
	const registeredNativeWebSearchTools = new Set<string>();
	let latestRecentWebSearchInput: ResponseInput | undefined;
	let backgroundWidgetRenderTimer: ReturnType<typeof setTimeout> | undefined;

	function customRenderingOptions(config = state.config): { customRendering: boolean } {
		return { customRendering: config.ui.toolRendering };
	}

	function promptSnippetOptions(config = state.config): { promptSnippet: boolean } {
		return { promptSnippet: config.mode === "path" };
	}

	function bundledPathToolsEnv(config = state.config): NodeJS.ProcessEnv {
		return createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: config.openai.webSearchModel });
	}

	function registerCoreTools(config = state.config): void {
		registerApplyPatchTool(pi, { ...promptSnippetOptions(config), showDiffWhenCollapsed: config.mode === "normal" });
		registerExecCommandTool(pi, tracker, sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...customRenderingOptions(config), ...promptSnippetOptions(config), showOutputWhenCollapsed: config.mode === "normal" });
		registerWriteStdinTool(pi, sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...promptSnippetOptions(config) });
		registerViewImageTool(pi, { describeForTextModels: config.tools.viewImageFallback, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
	}

	function ensureOptionalNativeToolsRegistered(config = state.config): void {
		const allowConfiguredProvider = (model: Model<any> | undefined): boolean => {
			if (config.scope.allProviders) return true;
			const provider = model?.provider?.trim().toLowerCase();
			return Boolean(provider && config.scope.additionalProviders.includes(provider));
		};
		if (config.tools.webRun) {
			const webSearchToolName = WEB_SEARCH_TOOL_NAME;
			registerWebSearchTool(pi, webSearchToolName, { getRecentInput: () => latestRecentWebSearchInput, model: () => state.config.openai.webSearchModel, allowConfiguredProvider, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
			registeredNativeWebSearchTools.add(webSearchToolName);
		}
		if (config.tools.imageGeneration) {
			registerImageGenerationTool(pi, { allowConfiguredProvider, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
		}
	}

	registerOpenAICodexCustomProvider(pi, {
		getCurrentCwd: () => state.cwd,
		getConfig: () => state.config.openai,
	});
	registerCoreTools();
	ensureOptionalNativeToolsRegistered();
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
		registerCoreTools(config);
		ensureOptionalNativeToolsRegistered(config);
		sessions.setBaseEnv(bundledPathToolsEnv(config));
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
		sessions.setBaseEnv(bundledPathToolsEnv());
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		tracker.clear();
		clearApplyPatchRenderState();
		clearPathApplyPatchPreviewStates();
		ensureOptionalNativeToolsRegistered();
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
		state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
		ensureOptionalNativeToolsRegistered();
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
				mode: state.config.mode,
				tools: state.config.mode === "path" ? { ...state.config.tools, viewImage: supportsViewImageInputs(ctx.model) || state.config.tools.viewImageFallback } : undefined,
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

	pi.on("context", async (event, ctx) => {
		const messages = event.messages.filter((message) => !isAdapterContextExcludedCustomMessage(message));
		latestRecentWebSearchInput = ctx.model ? buildRecentWebSearchInput(convertResponsesMessages(ctx.model as never, { messages: messages as never }, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false })) : undefined;
		return { messages };
	});
}

export { getCodexSkillPaths, mergeAdapterTools, restoreTools, stripAdapterTools };
