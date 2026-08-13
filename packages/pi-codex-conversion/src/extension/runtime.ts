import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { dirname } from "node:path";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { getCodexConversionConfigPath, readCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { rewriteCodexPrewarmProviderRequest, rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { getDefaultCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.ts";
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
import { createLazyCodexDiagnostics } from "../diagnostics/lazy.ts";
import type { CodexDiagnosticsSink } from "../providers/openai-codex/types.ts";

export type CodexContext = ExtensionContext;

export type CodexPrewarmResult =
	| { status: "ready" }
	| { status: "aborted" }
	| { status: "failed"; error: Error };

export interface CodexExtensionRuntime {
	state: AdapterState;
	tracker: ReturnType<typeof createExecCommandTracker>;
	sessions: ReturnType<typeof createExecSessionManager>;
	backgroundWidget: BackgroundBashWidgetState;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
	execEnv(config?: CodexConversionConfig): NodeJS.ProcessEnv;
	codexSystemPrompt(basePrompt: string, ctx: CodexContext, skills?: AdapterState["promptSkills"], systemPromptOptions?: PiSystemPromptOptions): string;
	startPrewarm(ctx: CodexContext, systemPrompt?: string, prepared?: boolean): Promise<CodexPrewarmResult> | undefined;
	startCompactionPrewarm(ctx: CodexContext): Promise<CodexPrewarmResult> | undefined;
	resetTransport(sessionId?: string): void;
	resetTransportAfterCompaction(sessionId: string): void;
	shutdownTransport(sessionId: string): void;
	waitForPrewarm(ctx: CodexContext, systemPrompt: string): Promise<CodexPrewarmResult> | undefined;
	prewarmIdentity(ctx: CodexContext, systemPrompt: string): string | undefined;
	configureDiagnostics(ctx: CodexContext, announceLog?: boolean): Promise<void>;
	diagnosticsSink(): CodexDiagnosticsSink | undefined;
	shutdownDiagnostics(): Promise<void>;
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
	let prewarmPromise: Promise<CodexPrewarmResult> | undefined;
	let prewarmTransportSettlement: Promise<void> | undefined;
	let pendingPrewarmKey: string | undefined;
	let prewarmedIdentity: string | undefined;
	const voice = new CodexVoiceController(pi);
	const diagnostics = createLazyCodexDiagnostics();
	const buildPrewarmPlan = (
		ctx: CodexContext,
		systemPrompt: string,
		prepared: boolean,
		messages: Context["messages"],
		rewriteCompactedReplay: boolean,
	) => {
		const model = ctx.model;
		const config = structuredClone(state.config);
		if (!model || model.provider !== "openai-codex" || !isAdapterRuntime(resolveCodexRuntimePlan(ctx, config)) || !config.openai.forceCachedWebSockets) return undefined;
		const preparedSystemPrompt = prepared
			? systemPrompt
			: runtime.codexSystemPrompt(systemPrompt, ctx);
		const tools = activeToolContext(pi);
		const reasoning = prewarmReasoningOption(pi.getThinkingLevel());
		const identity = JSON.stringify({
			model: { provider: model.provider, id: model.id, api: model.api, baseUrl: model.baseUrl },
			systemPrompt: preparedSystemPrompt,
			tools,
			reasoning,
			openai: config.openai,
			beta: config.beta,
			compaction: config.compaction,
		});
		const key = JSON.stringify({
			identity,
			messages,
			rewriteCompactedReplay,
		});
		return {
			model,
			config,
			preparedSystemPrompt,
			tools,
			reasoning,
			identity,
			key,
		};
	};
	const startPrewarm = (
		ctx: CodexContext,
		systemPrompt = ctx.getSystemPrompt(),
		prepared = false,
		messages: Context["messages"] = [],
		rewriteCompactedReplay = false,
	): Promise<CodexPrewarmResult> | undefined => {
		const plan = buildPrewarmPlan(ctx, systemPrompt, prepared, messages, rewriteCompactedReplay);
		if (!plan) return undefined;
		const { model, config, preparedSystemPrompt, tools, reasoning, identity, key: prewarmKey } = plan;
		if (pendingPrewarmKey === prewarmKey) return prewarmPromise;
		if (!pendingPrewarmKey && prewarmedIdentity === identity) return undefined;
		const previousTransportSettlement = prewarmTransportSettlement;
		prewarmedIdentity = undefined;
		prewarmController?.abort();
		const controller = new AbortController();
		prewarmController = controller;
		pendingPrewarmKey = prewarmKey;
		const promise = (async () => {
			if (previousTransportSettlement) await previousTransportSettlement.catch(() => undefined);
			if (controller.signal.aborted) return { status: "aborted" } as const;
			const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
			if (controller.signal.aborted) return { status: "aborted" } as const;
			if (!auth.ok) return { status: "failed", error: new Error(auth.error) } as const;
			if (!auth.apiKey) return {
				status: "failed",
				error: new Error(`No API key found for "${model.provider}"`),
			} as const;
			const requestModel = auth.baseUrl ? { ...model, baseUrl: auth.baseUrl } : model;
			try {
				const transportSettlement = prewarmOpenAICodexWebSocket(
					requestModel,
					{ systemPrompt: preparedSystemPrompt, messages, tools },
					{
						apiKey: auth.apiKey,
						...(auth.headers ? { headers: auth.headers } : {}),
						...(auth.env ? { env: auth.env } : {}),
						sessionId: ctx.sessionManager.getSessionId(),
						signal: controller.signal,
						...reasoning,
						textVerbosity: config.openai.verbosity,
						...(config.openai.fast ? { serviceTier: "priority" as const } : {}),
						onPayload: (body) => rewriteCompactedReplay
							? rewriteCodexProviderRequest(body, ctx, { ...state, config })
							: rewriteCodexPrewarmProviderRequest(body, ctx, { ...state, config }),
					},
					{
						getConfig: () => ({ openai: config.openai, beta: config.beta, compaction: config.compaction }),
						useResponsesLite: (currentModel) => resolveCodexRuntimePlan({ model: currentModel }, config).kind === "code",
						turnState: state.codexTurnState,
						getDiagnostics: () => diagnostics.sink(),
					},
				);
				prewarmTransportSettlement = transportSettlement;
				try {
					await transportSettlement;
				} finally {
					if (prewarmTransportSettlement === transportSettlement) prewarmTransportSettlement = undefined;
				}
			} catch (error) {
				if (controller.signal.aborted) return { status: "aborted" } as const;
				const failure = error instanceof Error ? error : new Error(String(error));
				if (process.env["PI_DEBUG"] === "1") {
					console.warn(`[pi-codex-conversion] WebSocket prewarm failed: ${failure.message}`);
				}
				return { status: "failed", error: failure } as const;
			}
			if (controller.signal.aborted) return { status: "aborted" } as const;
			prewarmedIdentity = identity;
			return { status: "ready" } as const;
		})().finally(() => {
			if (prewarmPromise === promise) {
				prewarmPromise = undefined;
				if (pendingPrewarmKey === prewarmKey) pendingPrewarmKey = undefined;
			}
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
				.filter((message) => !isProviderContextExcludedMessage(message));
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
			pendingPrewarmKey = undefined;
			prewarmedIdentity = undefined;
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
			return runtime.startPrewarm(ctx, systemPrompt, true);
		},
		prewarmIdentity(ctx, systemPrompt) {
			return buildPrewarmPlan(ctx, systemPrompt, true, [], false)?.identity;
		},
		configureDiagnostics(ctx, announceLog = false) {
			return diagnostics.configure({
				mode: state.config.openai.cacheDiagnostics,
				active: ctx.model?.provider === "openai-codex",
				ctx,
				agentDir: dirname(getCodexConversionConfigPath()),
				announceLog,
			});
		},
		diagnosticsSink() {
			return diagnostics.sink();
		},
		shutdownDiagnostics() {
			return diagnostics.shutdown();
		},
	};
	return runtime;
}
