import { buildSessionContext, convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { Context } from "@earendil-works/pi-ai";
import { dirname } from "node:path";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { readCodexCacheEnvironment } from "../adapter/activation/cache-environment.ts";
import { resolveCodexCacheKeepalivePlan, type CodexCacheKeepalivePlan, type CodexCacheKeepaliveStrategy } from "../adapter/activation/cache-keepalive.ts";
import { getCodexConversionConfigPath, readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { isAdapterRuntime, resolveCodexRuntimePlan, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { rewriteCodexPrewarmProviderRequest, rewriteCodexProviderRequest } from "../adapter/provider-request.ts";
import { getPiCodexRuntimeShell } from "../adapter/prompt/runtime-shell.ts";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.ts";
import { buildCodexSystemPrompt, type PiSystemPromptOptions } from "../prompt/build-system-prompt.ts";
import { closeOpenAICodexKeepaliveWebSocketSession, closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket } from "../providers/openai-codex-custom-provider.ts";
import { resetOpenAICodexWebSocketSessions } from "../providers/openai-codex/websocket.ts";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.ts";
import type { CodexPrewarmUsage, OpenAICodexStreamOptions } from "../providers/openai-codex/types.ts";
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
	| { status: "ready"; usage?: CodexPrewarmUsage | undefined; socketReused?: boolean | undefined }
	| { status: "skipped" }
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
	startKeepalivePrewarm(ctx: CodexContext): Promise<CodexPrewarmResult> | undefined;
	armCacheKeepalive(ctx: CodexContext): void;
	cancelCacheKeepalive(): void;
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
	const cacheEnvironment = readCodexCacheEnvironment();
	for (const warning of cacheEnvironment.warnings) {
		console.warn(`[pi-codex-conversion] ${warning}`);
	}
	const initialConfig = readEffectiveCodexConversionConfig({ cwd: process.cwd(), projectTrusted: false });
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: initialConfig,
		executionMode: initialConfig.executionMode,
		codexTurnState: createCodexTurnState(),
	};
	const tracker = createExecCommandTracker();
	const sessions = createExecSessionManager({
		env: { ...process.env, PI_CODEX_MODEL: state.config.openai.webSearchModel },
		bridgeBinaryPath: () => getBundledToolBinaryPath("exec_bridge", {}, state.config.tools.customRustBinariesDir),
	});
	let prewarmController: AbortController | undefined;
	let prewarmPromise: Promise<CodexPrewarmResult> | undefined;
	let prewarmTransportSettlement: Promise<unknown> | undefined;
	let pendingPrewarmKey: string | undefined;
	let prewarmedKey: string | undefined;
	let activePrewarmKind: "ordinary" | "compaction" | "keepalive" | undefined;
	let cacheKeepaliveTimer: ReturnType<typeof setTimeout> | undefined;
	let cacheKeepaliveEpoch = 0;
	const voice = new CodexVoiceController(pi);
	const diagnostics = createLazyCodexDiagnostics();
	let cacheEnvironmentWarningsReported = false;
	const buildPrewarmPlan = (
		ctx: CodexContext,
		systemPrompt: string,
		prepared: boolean,
		messages: Context["messages"],
		rewriteFinalRequest: boolean,
		promptCacheRefresh = false,
	) => {
		const model = ctx.model;
		const config = structuredClone(state.config);
		const executionMode = state.executionMode;
		const runtimePlan = resolveCodexRuntimePlanForState(ctx, { config, executionMode });
		if (
			!model
			|| !runtimePlan.codexTransport
			|| !isAdapterRuntime(runtimePlan)
			|| (!promptCacheRefresh && !config.openai.forceCachedWebSockets)
		) return undefined;
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
			compaction: config.compaction,
			executionMode,
		});
		const key = JSON.stringify({
			identity,
			messages,
			rewriteFinalRequest,
		});
		return {
			model,
			config,
			executionMode,
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
		rewriteFinalRequest = false,
		force = false,
		kind: "ordinary" | "compaction" | "keepalive" = "ordinary",
		preserveContinuation = false,
		keepaliveStrategy?: CodexCacheKeepaliveStrategy,
		requestSource?: "captured" | "reconstructed",
		generate = false,
	): Promise<CodexPrewarmResult> | undefined => {
		const plan = buildPrewarmPlan(ctx, systemPrompt, prepared, messages, rewriteFinalRequest, kind === "keepalive");
		if (!plan) return undefined;
		const { model, config, executionMode, preparedSystemPrompt, tools, reasoning, key: requestKey } = plan;
		const prewarmKey = JSON.stringify({ requestKey, preserveContinuation, generate });
		if (pendingPrewarmKey === prewarmKey) return prewarmPromise;
		if (!force && !pendingPrewarmKey && prewarmedKey === prewarmKey) return undefined;
		const previousTransportSettlement = prewarmTransportSettlement;
		prewarmedKey = undefined;
		prewarmController?.abort();
		const controller = new AbortController();
		prewarmController = controller;
		activePrewarmKind = kind;
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
						onPayload: (body) => rewriteFinalRequest
							? rewriteCodexProviderRequest(body, ctx, { ...state, config, executionMode })
							: rewriteCodexPrewarmProviderRequest(body, ctx, { ...state, config, executionMode }),
					},
					{
						getConfig: () => ({ executionMode, openai: config.openai, compaction: config.compaction }),
						useResponsesLite: (currentModel) => resolveCodexRuntimePlan({ model: currentModel }, config, executionMode).transport === "responses-lite",
						turnState: state.codexTurnState,
						getDiagnostics: () => diagnostics.sink(),
						...(preserveContinuation ? { preserveContinuation: true } : {}),
						...(kind === "keepalive" ? { retainSocket: config.openai.forceCachedWebSockets } : {}),
						prewarmDiagnostics: {
							kind,
							...(keepaliveStrategy ? { keepaliveStrategy } : {}),
							...(requestSource ? { requestSource } : {}),
						},
						...(generate ? { generate: true } : {}),
					},
				);
				prewarmTransportSettlement = transportSettlement;
				try {
					const result = await transportSettlement;
					if (controller.signal.aborted) return { status: "aborted" } as const;
					if (!result) return { status: "skipped" } as const;
					if (kind !== "keepalive") prewarmedKey = prewarmKey;
					return { status: "ready", ...(result.usage ? { usage: result.usage } : {}), socketReused: result.socketReused } as const;
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
		})().finally(() => {
			if (prewarmPromise === promise) {
				prewarmPromise = undefined;
				if (pendingPrewarmKey === prewarmKey) pendingPrewarmKey = undefined;
			}
			if (prewarmController === controller) {
				prewarmController = undefined;
				activePrewarmKind = undefined;
			}
		});
		prewarmPromise = promise;
		return promise;
	};

	const currentMessages = (ctx: CodexContext) => convertToLlm(
		buildSessionContext(ctx.sessionManager.getBranch()).messages
			.filter((message) => !isProviderContextExcludedMessage(message)),
	);

	const currentContextPrewarm = (ctx: CodexContext, kind: "compaction" | "keepalive") => {
		const keepalivePlan = kind === "keepalive"
			? resolveCodexCacheKeepalivePlan(ctx.model?.id, state.config.openai)
			: undefined;
		if (kind === "keepalive" && !keepalivePlan) return undefined;
		const preserveContinuation = kind === "keepalive";
		const activeSystemPrompt = state.activeProviderSystemPrompt;
		return startPrewarm(
			ctx,
			activeSystemPrompt ?? ctx.getSystemPrompt(),
			activeSystemPrompt !== undefined,
			currentMessages(ctx),
			true,
			kind === "keepalive",
			kind,
			preserveContinuation,
			keepalivePlan?.strategy,
			kind === "keepalive" ? "reconstructed" : undefined,
			keepalivePlan?.strategy === "generated-current",
		);
	};

	const cancelCacheKeepalive = () => {
		cacheKeepaliveEpoch++;
		if (cacheKeepaliveTimer) clearTimeout(cacheKeepaliveTimer);
		cacheKeepaliveTimer = undefined;
		if (activePrewarmKind === "keepalive") prewarmController?.abort();
	};

	const scheduleCacheKeepalive = (
		ctx: CodexContext,
		epoch: number,
		plan: CodexCacheKeepalivePlan,
		completedOperations: number,
	) => {
		if (plan.maxOperations !== undefined && completedOperations >= plan.maxOperations) return;
		if (cacheKeepaliveTimer) clearTimeout(cacheKeepaliveTimer);
		diagnostics.sink()?.({
			type: "keepalive",
			phase: "armed",
			strategy: plan.strategy,
			intervalMs: plan.intervalMs,
		});
		cacheKeepaliveTimer = setTimeout(() => {
			cacheKeepaliveTimer = undefined;
			if (epoch !== cacheKeepaliveEpoch || !ctx.isIdle()) return;
			const nextCompletedOperations = completedOperations + 1;
			const requestSource = "reconstructed";
			diagnostics.sink()?.({ type: "keepalive", phase: "started", strategy: plan.strategy, requestSource });
			const keepalive = currentContextPrewarm(ctx, "keepalive");
			if (!keepalive) {
				diagnostics.sink()?.({ type: "keepalive", phase: "skipped", strategy: plan.strategy, requestSource });
				return;
			}
			void keepalive.then((result) => {
				if (epoch !== cacheKeepaliveEpoch || result.status === "aborted" || result.status === "skipped") return;
				if (result.status === "failed") {
					ctx.ui.notify(`Codex cache keepalive failed: ${result.error.message}`, "warning");
					scheduleCacheKeepalive(ctx, epoch, plan, nextCompletedOperations);
					return;
				}
				const action = "generated-refresh";
				diagnostics.sink()?.({ type: "keepalive", phase: "applied", strategy: plan.strategy, requestSource, action });
				scheduleCacheKeepalive(ctx, epoch, plan, nextCompletedOperations);
			});
		}, plan.intervalMs);
		cacheKeepaliveTimer.unref?.();
	};

	const armCacheKeepalive = (ctx: CodexContext) => {
		cancelCacheKeepalive();
		const plan = resolveCodexCacheKeepalivePlan(ctx.model?.id, state.config.openai);
		if (plan) scheduleCacheKeepalive(ctx, cacheKeepaliveEpoch, plan, 0);
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
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			return buildCodexSystemPrompt(basePrompt, {
				skills,
				shell: getPiCodexRuntimeShell(ctx),
				mode: plan.prompt ?? "normal",
				heavySystemPromptOverwrite: state.config.prompt.heavySystemPromptOverwrite,
				systemPromptOptions,
			});
		},
		startPrewarm(ctx, systemPrompt, prepared) {
			return startPrewarm(ctx, systemPrompt, prepared);
		},
		startCompactionPrewarm(ctx) {
			return currentContextPrewarm(ctx, "compaction");
		},
		startKeepalivePrewarm(ctx) {
			return currentContextPrewarm(ctx, "keepalive");
		},
		armCacheKeepalive(ctx) {
			armCacheKeepalive(ctx);
		},
		cancelCacheKeepalive() {
			cancelCacheKeepalive();
		},
		resetTransport(sessionId) {
			cancelCacheKeepalive();
			prewarmController?.abort();
			prewarmController = undefined;
			pendingPrewarmKey = undefined;
			prewarmedKey = undefined;
			state.codexTurnState.reset();
			if (sessionId) {
				resetOpenAICodexWebSocketSessions(sessionId);
				closeOpenAICodexKeepaliveWebSocketSession(sessionId);
			} else closeOpenAICodexWebSocketSessions();
		},
		resetTransportAfterCompaction(sessionId) {
			runtime.resetTransport(sessionId);
			closeOpenAICodexWebSocketSessions(sessionId);
		},
		shutdownTransport(sessionId) {
			cancelCacheKeepalive();
			runtime.resetTransport(sessionId);
			closeOpenAICodexWebSocketSessions(sessionId);
		},
		waitForPrewarm(ctx, systemPrompt) {
			return startPrewarm(ctx, systemPrompt, true, currentMessages(ctx), true);
		},
		prewarmIdentity(ctx, systemPrompt) {
			return buildPrewarmPlan(ctx, systemPrompt, true, [], false)?.identity;
		},
		configureDiagnostics(ctx, announceLog = false) {
			if (!cacheEnvironmentWarningsReported && cacheEnvironment.warnings.length > 0) {
				cacheEnvironmentWarningsReported = true;
				ctx.ui.notify(`Codex cache diagnostics: ${cacheEnvironment.warnings.join("; ")}`, "warning");
			}
			return diagnostics.configure({
				mode: state.config.openai.cacheDiagnostics,
				active: ctx.model?.provider === "openai-codex",
				ctx,
				agentDir: dirname(getCodexConversionConfigPath()),
				logName: cacheEnvironment.logName,
				announceLog: announceLog || cacheEnvironment.logName !== undefined,
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
