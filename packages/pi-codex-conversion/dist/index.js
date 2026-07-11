import { Box, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { getDefaultCodexRuntimeShell } from "./adapter/prompt/runtime-shell.js";
import { clearApplyPatchRenderState, registerApplyPatchTool } from "./tools/apply-patch/tool.js";
import { clearPathApplyPatchPreviewStates } from "./tools/path/apply-patch-preview.js";
import { createExecCommandTracker } from "./tools/exec/command-state.js";
import { registerExecCommandTool } from "./tools/exec/command-tool.js";
import { createExecSessionManager } from "./tools/exec/session-manager.js";
import { closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket, registerOpenAICodexCustomProvider } from "./providers/openai-codex-custom-provider.js";
import { registerImageGenerationTool } from "./tools/imagegen/tool.js";
import { buildCodexSystemPrompt, extractPiPromptSkills, resolvePromptSkills } from "./prompt/build-system-prompt.js";
import { registerViewImageTool, supportsViewImageInputs } from "./tools/view-image/tool.js";
import { buildRecentWebSearchInput, registerWebSearchTool } from "./tools/web-run/tool.js";
import { registerWriteStdinTool } from "./tools/exec/write-stdin-tool.js";
import { createBundledPathToolsEnv } from "./tools/path/binary.js";
import { readCodexConversionConfig } from "./adapter/activation/config.js";
import { syncAdapter, mergeAdapterTools, restoreTools, stripAdapterTools, shouldUseCodexAdapter } from "./adapter/activation/activation.js";
import { rewriteCodexProviderRequest } from "./adapter/provider-request.js";
import { handleCodexSessionBeforeCompact } from "./adapter/compaction/compaction.js";
import { isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT } from "./adapter/compaction/types.js";
import { isAdapterContextExcludedCustomMessage } from "./adapter/prompt/context-filter.js";
import { getCodexSkillPaths, hasNoSkillsFlag } from "./adapter/prompt/skills.js";
import { registerCodexCommand } from "./ui/settings/command.js";
import { WEB_SEARCH_TOOL_NAME } from "./adapter/activation/tool-set.js";
import { BACKGROUND_BASH_WIDGET_ID, registerBackgroundBashWidgetShortcuts, renderBackgroundBashWidget } from "./ui/background-bash-widget.js";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages } from "./providers/openai-responses/shared.js";
import { maybeWarnLocalCheckoutVersion } from "./adapter/local-version-warning.js";
import { createCodexTurnState } from "./providers/openai-codex/turn-state.js";
import { initializeBashParser } from "./shell/bash.js";
function getCommandArg(args) {
    if (!args || typeof args !== "object" || !("cmd" in args) || typeof args.cmd !== "string") {
        return undefined;
    }
    return args.cmd;
}
function isToolCallOnlyAssistantMessage(message) {
    if (!message || typeof message !== "object" || !("role" in message) || message.role !== "assistant") {
        return false;
    }
    if (!("content" in message) || !Array.isArray(message.content) || message.content.length === 0) {
        return false;
    }
    return message.content.every((item) => typeof item === "object" && item !== null && "type" in item && item.type === "toolCall");
}
export default function codexConversion(pi) {
    const tracker = createExecCommandTracker();
    const state = { enabled: false, cwd: process.cwd(), promptSkills: [], config: readCodexConversionConfig(), codexTurnState: createCodexTurnState() };
    const sessions = createExecSessionManager({ env: createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel }) });
    const backgroundBashWidget = { folded: true };
    const registeredNativeWebSearchTools = new Set();
    let latestRecentWebSearchInput;
    let backgroundWidgetRenderTimer;
    let prewarmController;
    let prewarmPromise;
    let websocketPrewarmed = false;
    function customRenderingOptions(config = state.config) {
        return { customRendering: config.ui.toolRenaming };
    }
    function showCollapsedPatchDiff(config = state.config) {
        return config.mode === "normal" && !config.ui.compactTools;
    }
    function promptSnippetOptions(config = state.config) {
        return { promptSnippet: config.mode === "path" };
    }
    function bundledPathToolsEnv(config = state.config) {
        return createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: config.openai.webSearchModel });
    }
    function codexSystemPrompt(basePrompt, ctx, skills = state.promptSkills) {
        return buildCodexSystemPrompt(basePrompt, {
            skills,
            shell: getDefaultCodexRuntimeShell(),
            mode: state.config.mode,
            tools: state.config.mode === "path" ? { ...state.config.tools, viewImage: supportsViewImageInputs(ctx.model) || state.config.tools.viewImageFallback } : undefined,
        });
    }
    function startWebSocketPrewarm(ctx, systemPrompt = ctx.getSystemPrompt()) {
        const model = ctx.model;
        if (websocketPrewarmed || !model || model.provider !== "openai-codex" || !shouldUseCodexAdapter(ctx, state.config) || !state.config.openai.forceCachedWebSockets)
            return undefined;
        prewarmController?.abort();
        const controller = new AbortController();
        prewarmController = controller;
        const activeTools = new Set(pi.getActiveTools());
        const tools = pi.getAllTools()
            .filter((tool) => activeTools.has(tool.name))
            .map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters }));
        const promise = (async () => {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (!auth.ok || !auth.apiKey || controller.signal.aborted)
                return;
            await prewarmOpenAICodexWebSocket(model, { systemPrompt: codexSystemPrompt(systemPrompt, ctx), messages: [], tools }, {
                apiKey: auth.apiKey,
                ...(auth.headers ? { headers: auth.headers } : {}),
                ...(auth.env ? { env: auth.env } : {}),
                sessionId: ctx.sessionManager.getSessionId(),
                signal: controller.signal,
                reasoning: pi.getThinkingLevel(),
                textVerbosity: state.config.openai.verbosity,
                ...(state.config.openai.fast ? { serviceTier: "priority" } : {}),
                onPayload: (body) => rewriteCodexProviderRequest(body, ctx, state),
            }, { getConfig: () => ({ openai: state.config.openai, beta: state.config.beta }), turnState: state.codexTurnState });
            if (!controller.signal.aborted)
                websocketPrewarmed = true;
        })().catch(() => undefined).finally(() => {
            if (prewarmPromise === promise)
                prewarmPromise = undefined;
            if (prewarmController === controller)
                prewarmController = undefined;
        });
        prewarmPromise = promise;
        return promise;
    }
    function registerCoreTools(config = state.config) {
        registerApplyPatchTool(pi, { ...promptSnippetOptions(config), showDiffWhenCollapsed: showCollapsedPatchDiff(config) });
        registerExecCommandTool(pi, tracker, sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...customRenderingOptions(config), ...promptSnippetOptions(config), showOutputWhenCollapsed: config.mode === "normal", compactTools: config.ui.compactTools });
        registerWriteStdinTool(pi, sessions, { describeImagesForTextModels: config.tools.viewImageFallback, ...promptSnippetOptions(config) });
        registerViewImageTool(pi, { describeForTextModels: config.tools.viewImageFallback, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
    }
    function ensureOptionalNativeToolsRegistered(config = state.config) {
        const allowConfiguredProvider = (model) => {
            if (config.scope.allProviders !== "off")
                return true;
            const provider = model?.provider?.trim().toLowerCase();
            return Boolean(provider && config.scope.additionalProviders.includes(provider));
        };
        if (config.tools.webRun || config.tools.webRunOnly) {
            const webSearchToolName = WEB_SEARCH_TOOL_NAME;
            registerWebSearchTool(pi, webSearchToolName, { getRecentInput: () => latestRecentWebSearchInput, model: () => state.config.openai.webSearchModel, allowConfiguredProvider, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
            registeredNativeWebSearchTools.add(webSearchToolName);
        }
        if (config.tools.imageGeneration || config.tools.imageGenerationOnly) {
            registerImageGenerationTool(pi, { allowConfiguredProvider, ...customRenderingOptions(config), ...promptSnippetOptions(config) });
        }
    }
    registerOpenAICodexCustomProvider(pi, {
        getCurrentCwd: () => state.cwd,
        getConfig: () => ({ openai: state.config.openai, beta: state.config.beta }),
        turnState: state.codexTurnState,
    });
    registerCoreTools();
    ensureOptionalNativeToolsRegistered();
    function clearBackgroundShellWidget() {
        if (backgroundWidgetRenderTimer) {
            clearTimeout(backgroundWidgetRenderTimer);
            backgroundWidgetRenderTimer = undefined;
        }
        backgroundBashWidget.ctx?.ui.setWidget(BACKGROUND_BASH_WIDGET_ID, undefined);
    }
    function renderBackgroundShellWidget(ctx = backgroundBashWidget.ctx) {
        if (!ctx)
            return;
        if (!state.config.ui.backgroundShellWidget) {
            clearBackgroundShellWidget();
            return;
        }
        renderBackgroundBashWidget(ctx, backgroundBashWidget, sessions);
    }
    function applyConfig(config) {
        registerCoreTools(config);
        ensureOptionalNativeToolsRegistered(config);
        sessions.setBaseEnv(bundledPathToolsEnv(config));
        if (!config.ui.backgroundShellWidget)
            clearBackgroundShellWidget();
        else
            renderBackgroundShellWidget();
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
                if (backgroundWidgetRenderTimer)
                    return;
                backgroundWidgetRenderTimer = setTimeout(() => {
                    backgroundWidgetRenderTimer = undefined;
                    if (backgroundBashWidget.ctx)
                        renderBackgroundShellWidget(backgroundBashWidget.ctx);
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
    pi.on("session_start", async (event, ctx) => {
        initializeBashParser();
        websocketPrewarmed = false;
        state.codexTurnState.reset();
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
        void startWebSocketPrewarm(ctx);
        if (event.reason === "startup")
            await maybeWarnLocalCheckoutVersion(ctx);
    });
    pi.on("resources_discover", async (event) => {
        if (hasNoSkillsFlag())
            return undefined;
        const skillPaths = getCodexSkillPaths(event.cwd);
        return skillPaths.length > 0 ? { skillPaths } : undefined;
    });
    pi.on("model_select", async (_event, ctx) => {
        prewarmController?.abort();
        prewarmController = undefined;
        prewarmPromise = undefined;
        websocketPrewarmed = false;
        state.codexTurnState.reset();
        const sessionId = ctx.sessionManager.getSessionId();
        if (sessionId)
            closeOpenAICodexWebSocketSessions(sessionId);
        state.cwd = ctx.cwd;
        state.promptSkills = extractPiPromptSkills(ctx.getSystemPrompt());
        ensureOptionalNativeToolsRegistered();
        syncAdapter(pi, ctx, state);
        void startWebSocketPrewarm(ctx);
    });
    pi.on("message_start", async (event) => {
        if (event.message.role === "toolResult")
            return;
        if (isToolCallOnlyAssistantMessage(event.message))
            return;
        tracker.resetExplorationGroup();
    });
    pi.on("tool_execution_start", async (event) => {
        if (event.toolName !== "exec_command") {
            tracker.resetExplorationGroup();
            return;
        }
        const command = getCommandArg(event.args);
        if (!command)
            return;
        tracker.recordStart(event.toolCallId, command);
    });
    pi.on("tool_execution_end", async (event) => {
        if (event.toolName !== "exec_command")
            return;
        tracker.recordEnd(event.toolCallId);
    });
    pi.on("session_shutdown", async () => {
        prewarmController?.abort();
        prewarmController = undefined;
        prewarmPromise = undefined;
        websocketPrewarmed = false;
        state.codexTurnState.reset();
        clearBackgroundShellWidget();
        backgroundBashWidget.ctx = undefined;
        sessions.shutdown();
    });
    pi.on("input", async (event) => {
        // Keep state across model/tool continuations, but never across separate idle prompts.
        if (event.streamingBehavior === undefined)
            state.codexTurnState.beginTurn();
    });
    pi.on("before_agent_start", async (event, ctx) => {
        if (!shouldUseCodexAdapter(ctx, state.config)) {
            return undefined;
        }
        const skills = resolvePromptSkills(event.systemPromptOptions?.skills, hasNoSkillsFlag() ? [] : state.promptSkills);
        await (prewarmPromise ?? startWebSocketPrewarm(ctx, event.systemPrompt));
        return {
            systemPrompt: codexSystemPrompt(event.systemPrompt, ctx, skills),
        };
    });
    pi.on("agent_settled", async () => {
        state.codexTurnState.reset();
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
        if (!event.fromExtension || !isNativeCompactionDetails(event.compactionEntry.details))
            return;
        pi.sendMessage({
            customType: NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE,
            content: NATIVE_COMPACTION_DISPLAY_TEXT,
            display: true,
            details: { compactionEntryId: event.compactionEntry.id },
        }, { triggerTurn: false });
    });
    pi.on("context", async (event, ctx) => {
        const messages = event.messages.filter((message) => !isAdapterContextExcludedCustomMessage(message));
        latestRecentWebSearchInput = ctx.model ? buildRecentWebSearchInput(convertResponsesMessages(ctx.model, { messages: messages }, CODEX_TOOL_CALL_PROVIDERS, { includeSystemPrompt: false })) : undefined;
        return { messages };
    });
}
export { getCodexSkillPaths, mergeAdapterTools, restoreTools, stripAdapterTools };
