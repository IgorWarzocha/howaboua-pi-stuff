import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import type { ResponseInput } from "openai/resources/responses/responses.js";
import { readCodexConversionConfig, type CodexConversionConfig } from "../adapter/activation/config.ts";
import { shouldUseCodexAdapter, shouldUseGpt56CodeMode } from "../adapter/activation/activation.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { getDefaultCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import { buildCodexSystemPrompt } from "../prompt/build-system-prompt.ts";
import { closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket } from "../providers/openai-codex-custom-provider.ts";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.ts";
import type { OpenAICodexStreamOptions } from "../providers/openai-codex/types.ts";
import { createExecCommandTracker } from "../tools/exec/command-state.ts";
import { createExecSessionManager } from "../tools/exec/session-manager.ts";
import { createBundledPathToolsEnv } from "../tools/path/binary.ts";
import type { BackgroundBashWidgetState } from "../ui/background-bash-widget.ts";
import { supportsViewImageInputs } from "../tools/view-image/tool.ts";

export type CodexContext = Parameters<typeof shouldUseCodexAdapter>[0];

export interface CodexExtensionRuntime {
	state: AdapterState;
	tracker: ReturnType<typeof createExecCommandTracker>;
	sessions: ReturnType<typeof createExecSessionManager>;
	backgroundWidget: BackgroundBashWidgetState;
	registeredNativeWebSearchTools: Set<string>;
	latestRecentWebSearchInput: ResponseInput | undefined;
	bundledPathToolsEnv(config?: CodexConversionConfig): NodeJS.ProcessEnv;
	codexSystemPrompt(basePrompt: string, ctx: CodexContext, skills?: AdapterState["promptSkills"]): string;
	startPrewarm(ctx: CodexContext, systemPrompt?: string): Promise<void> | undefined;
	resetTransport(sessionId?: string): void;
	shutdownTransport(sessionId: string): void;
	waitForPrewarm(ctx: CodexContext, systemPrompt: string): Promise<void> | undefined;
}

function activeToolContext(pi: ExtensionAPI): NonNullable<Context["tools"]> {
	const activeTools = new Set(pi.getActiveTools());
	return pi.getAllTools()
		.filter((tool) => activeTools.has(tool.name))
		.map(({ name, description, parameters }) => ({ name, description, parameters }));
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
		env: createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel }),
	});
	let prewarmController: AbortController | undefined;
	let prewarmPromise: Promise<void> | undefined;
	let websocketPrewarmed = false;

	const runtime: CodexExtensionRuntime = {
		state,
		tracker,
		sessions,
		backgroundWidget: { folded: true },
		registeredNativeWebSearchTools: new Set<string>(),
		latestRecentWebSearchInput: undefined,
		bundledPathToolsEnv(config = state.config) {
			return createBundledPathToolsEnv({ ...process.env, PI_CODEX_MODEL: config.openai.webSearchModel });
		},
		codexSystemPrompt(basePrompt, ctx, skills = state.promptSkills) {
			const codeMode = shouldUseGpt56CodeMode(ctx, state.config);
			const pathShaped = state.config.mode === "path" || codeMode;
			return buildCodexSystemPrompt(basePrompt, {
				skills,
				shell: getDefaultCodexRuntimeShell(),
				mode: codeMode ? "code" : pathShaped ? "path" : "normal",
				tools: pathShaped
					? { ...state.config.tools, viewImage: supportsViewImageInputs(ctx.model) || state.config.tools.viewImageFallback }
					: undefined,
			});
		},
		startPrewarm(ctx, systemPrompt = ctx.getSystemPrompt()) {
			const model = ctx.model;
			if (websocketPrewarmed || !model || model.provider !== "openai-codex" || !shouldUseCodexAdapter(ctx, state.config) || !state.config.openai.forceCachedWebSockets) return undefined;
			prewarmController?.abort();
			const controller = new AbortController();
			prewarmController = controller;
			const promise = (async () => {
				const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
				if (!auth.ok || !auth.apiKey || controller.signal.aborted) return;
				await prewarmOpenAICodexWebSocket(
					model,
					{ systemPrompt: runtime.codexSystemPrompt(systemPrompt, ctx), messages: [], tools: activeToolContext(pi) },
					{
						apiKey: auth.apiKey,
						...(auth.headers ? { headers: auth.headers } : {}),
						...(auth.env ? { env: auth.env } : {}),
						sessionId: ctx.sessionManager.getSessionId(),
						signal: controller.signal,
						...prewarmReasoningOption(pi.getThinkingLevel()),
						textVerbosity: state.config.openai.verbosity,
						...(state.config.openai.fast ? { serviceTier: "priority" as const } : {}),
						onPayload: (body) => rewriteCodexProviderRequest(body, ctx, state),
					},
					{ getConfig: () => ({ openai: state.config.openai, beta: state.config.beta }), turnState: state.codexTurnState },
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
		},
		resetTransport(sessionId) {
			prewarmController?.abort();
			prewarmController = undefined;
			prewarmPromise = undefined;
			websocketPrewarmed = false;
			state.codexTurnState.reset();
			if (sessionId) closeOpenAICodexWebSocketSessions(sessionId);
		},
		shutdownTransport(sessionId) {
			runtime.resetTransport(sessionId);
		},
		waitForPrewarm(ctx, systemPrompt) {
			return prewarmPromise ?? runtime.startPrewarm(ctx, systemPrompt);
		},
	};
	return runtime;
}
