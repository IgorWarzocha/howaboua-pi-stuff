import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { dirname } from "node:path";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { getCodexConversionConfigPath, readCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { rewriteCodexPrewarmProviderRequest, rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { getDefaultCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import { isAdapterContextExcludedCustomMessage } from "../adapter/prompt/context-filter.ts";
import { buildCodexSystemPrompt, type PiSystemPromptOptions } from "../prompt/build-system-prompt.ts";
import { closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket } from "../providers/openai-codex-custom-provider.ts";
import { resetOpenAICodexWebSocketSessions } from "../providers/openai-codex/websocket.ts";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.ts";
import type { OpenAICodexStreamOptions } from "../providers/openai-codex/types.ts";
import { createExecCommandTracker } from "../tools/exec/command-state.ts";
import { createExecSessionManager } from "../tools/exec/session-manager.ts";
import { getBundledToolBinaryPath } from "../tools/native/binary.ts";
import type { BackgroundBashWidgetState } from "../ui/background-bash-widget.ts";
import { CodexVoiceController } from "../voice/controller.ts";
import { CodexLanVoiceServerController } from "../voice/lan/controller.ts";
import { getActiveToolsInActiveOrder } from "../adapter/active-tools.ts";

export type CodexContext = ExtensionContext;

export interface CodexExtensionRuntime {
	state: AdapterState;
	tracker: ReturnType<typeof createExecCommandTracker>;
	sessions: ReturnType<typeof createExecSessionManager>;
	backgroundWidget: BackgroundBashWidgetState;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
	execEnv(config?: CodexConversionConfig): NodeJS.ProcessEnv;
	codexSystemPrompt(basePrompt: string, ctx: CodexContext, skills?: AdapterState["promptSkills"], systemPromptOptions?: PiSystemPromptOptions): string;
	startPrewarm(ctx: CodexContext, systemPrompt?: string, prepared?: boolean): Promise<void> | undefined;
	startCompactionPrewarm(ctx: CodexContext): Promise<void> | undefined;
	resetTransport(sessionId?: string): void;
	resetTransportAfterCompaction(sessionId: string): void;
	shutdownTransport(sessionId: string): void;
	waitForPrewarm(ctx: CodexContext, systemPrompt: string): Promise<void> | undefined;
}

function activeToolContext(pi: ExtensionAPI): NonNullable<Context["tools"]> {
	// Pi ToolInfo omits constrainedSampling; restore our owned exec contract so
	// prewarm and the real Code Mode turn serialize the same provider tools.
	return getActiveToolsInActiveOrder(pi, true);
}

function prewarmReasoningOption(level: ReturnType<ExtensionAPI["getThinkingLevel"]>): Pick<OpenAICodexStreamOptions, "reasoning"> | Record<never, never> {
	return level === "off" ? {} : { reasoning: level };
}

export function createCodexExtensionRuntime(pi: ExtensionAPI): CodexExtensionRuntime {
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: readCodexConversionConfig(),
		codexTurnState: createCodexTurnState(),
	};
	const tracker = createExecCommandTracker();
	const sessions = createExecSessionManager({
		env: { ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel },
		bridgeBinaryPath: () => getBundledToolBinaryPath("exec_bridge", {}, state.config.tools.customRustBinariesDir),
	});
	let prewarmController: AbortController | undefined;
	let prewarmPromise: Promise<void> | undefined;
	let websocketPrewarmed = false;
	const voice = new CodexVoiceController(pi);
	const startPrewarm = (
		ctx: CodexContext,
		systemPrompt = ctx.getSystemPrompt(),
		prepared = false,
		messages: Context["messages"] = [],
		rewriteCompactedReplay = false,
	): Promise<void> | undefined => {
		const model = ctx.model;
		if (websocketPrewarmed || !model || model.provider !== "openai-codex" || !isAdapterRuntime(resolveCodexRuntimePlan(ctx, state.config)) || !state.config.openai.forceCachedWebSockets) return undefined;
		prewarmController?.abort();
		const controller = new AbortController();
		prewarmController = controller;
		const promise = (async () => {
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (!auth.ok || !auth.apiKey || controller.signal.aborted) return;
			await prewarmOpenAICodexWebSocket(
				model,
				{ systemPrompt: prepared ? systemPrompt : runtime.codexSystemPrompt(systemPrompt, ctx), messages, tools: activeToolContext(pi) },
				{
					apiKey: auth.apiKey,
					...(auth.headers ? { headers: auth.headers } : {}),
					...(auth.env ? { env: auth.env } : {}),
					sessionId: ctx.sessionManager.getSessionId(),
					signal: controller.signal,
					...prewarmReasoningOption(pi.getThinkingLevel()),
					textVerbosity: state.config.openai.verbosity,
					...(state.config.openai.fast ? { serviceTier: "priority" as const } : {}),
					onPayload: (body) => rewriteCompactedReplay
						? rewriteCodexProviderRequest(body, ctx, state)
						: rewriteCodexPrewarmProviderRequest(body, ctx, state),
				},
				{
					getConfig: () => ({ openai: state.config.openai, beta: state.config.beta, compaction: state.config.compaction }),
					useResponsesLite: (currentModel) => resolveCodexRuntimePlan({ model: currentModel }, state.config).kind === "code",
					turnState: state.codexTurnState,
				},
			);
			if (!controller.signal.aborted) websocketPrewarmed = true;
		})().catch((error: unknown) => {
			if (!controller.signal.aborted && process.env["PI_DEBUG"] === "1") {
				console.warn(`[pi-codex-conversion] WebSocket prewarm failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		}).finally(() => {
			if (prewarmPromise === promise) prewarmPromise = undefined;
			if (prewarmController === controller) prewarmController = undefined;
		});
		prewarmPromise = promise;
		return promise;
	};

	const runtime: CodexExtensionRuntime = {
		state,
		tracker,
		sessions,
		backgroundWidget: { folded: true },
		voice,
		lanVoice: new CodexLanVoiceServerController(
			voice,
			() => state.config,
			(text, ctx) => {
				if (ctx.isIdle()) pi.sendUserMessage(text);
				else pi.sendUserMessage(text, { deliverAs: "steer" });
			},
			dirname(getCodexConversionConfigPath()),
		),
		execEnv(config = state.config) {
			return { ...process.env, PI_CODEX_MODEL: config.openai.webSearchModel };
		},
		codexSystemPrompt(basePrompt, ctx, skills = state.promptSkills, systemPromptOptions) {
			const plan = resolveCodexRuntimePlan(ctx, state.config);
			return buildCodexSystemPrompt(basePrompt, {
				skills,
				shell: getDefaultCodexRuntimeShell(),
				mode: plan.prompt ?? "normal",
				heavySystemPromptOverwrite: state.config.prompt.heavySystemPromptOverwrite,
				systemPromptOptions,
			});
		},
		startPrewarm(ctx, systemPrompt, prepared) {
			return startPrewarm(ctx, systemPrompt, prepared);
		},
		startCompactionPrewarm(ctx) {
			const messages = buildSessionContext(ctx.sessionManager.getBranch()).messages
				.filter((message) => !isAdapterContextExcludedCustomMessage(message));
			const activeSystemPrompt = state.activeProviderSystemPrompt;
			return startPrewarm(
				ctx,
				activeSystemPrompt ?? ctx.getSystemPrompt(),
				activeSystemPrompt !== undefined,
				convertToLlm(messages),
				true,
			);
		},
		resetTransport(sessionId) {
			prewarmController?.abort();
			prewarmController = undefined;
			prewarmPromise = undefined;
			websocketPrewarmed = false;
			state.codexTurnState.reset();
			if (sessionId) resetOpenAICodexWebSocketSessions(sessionId);
			else closeOpenAICodexWebSocketSessions();
		},
		resetTransportAfterCompaction(sessionId) {
			runtime.resetTransport(sessionId);
			closeOpenAICodexWebSocketSessions(sessionId);
		},
		shutdownTransport(sessionId) {
			runtime.resetTransport(sessionId);
			closeOpenAICodexWebSocketSessions(sessionId);
		},
		waitForPrewarm(ctx, systemPrompt) {
			return prewarmPromise ?? runtime.startPrewarm(ctx, systemPrompt, true);
		},
	};
	return runtime;
}
