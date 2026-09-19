import { convertToLlm, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, type Api, type Context, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { dirname } from "node:path";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { readCodexCacheEnvironment } from "../adapter/activation/cache-environment.ts";
import { resolveCodexCacheKeepalivePlan, type CodexCacheKeepalivePlan, type CodexCacheKeepaliveStrategy } from "../adapter/activation/cache-keepalive.ts";
import { getCodexConversionConfigPath, readEffectiveCodexConversionConfig } from "../adapter/activation/config-store.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../adapter/activation/state.ts";
import { rewriteCodexProviderRequest, supportsCodexDeveloperMessages } from "../adapter/provider-request.ts";
import { isProviderContextExcludedMessage } from "../adapter/prompt/context-filter.ts";
import { closeOpenAICodexKeepaliveWebSocketSession, closeOpenAICodexWebSocketSessions, prewarmOpenAICodexWebSocket, prewarmPreparedOpenAICodexWebSocket } from "../providers/openai-codex-custom-provider.ts";
import { resetOpenAICodexWebSocketSessions } from "../providers/openai-codex/websocket.ts";
import { createCodexTurnState } from "../providers/openai-codex/turn-state.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
import type { CodexPrewarmUsage, OpenAICodexStreamOptions, ResponsesBody } from "../providers/openai-codex/types.ts";
import { createExecCommandTracker } from "../tools/exec/command-state.ts";
import { createExecSessionManager } from "../tools/exec/session-manager.ts";
import { getBundledToolBinaryPath } from "../tools/native/binary.ts";
import type { BackgroundBashWidgetState } from "../ui/background-bash-widget.ts";
import { CodexVoiceController } from "../voice/controller.ts";
import { CodexLanVoiceServerController } from "../voice/lan/controller.ts";
import { createLazyCodexDiagnostics } from "../diagnostics/lazy.ts";
import type { CodexDiagnosticsSink } from "../providers/openai-codex/types.ts";
import { CodexDeveloperMessageBridge } from "../adapter/developer-messages.ts";
import { CodexContextWindowManager } from "../context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../context-management/window-kickoff.ts";
import { CodexContextTreeCoordinator } from "../context-management/tree-coordinator.ts";
import { projectTreeCheckpointBranch, projectTreeCheckpointMessages } from "../context-management/tree-checkpoint.ts";
import { hasPendingCodexReasoningUpdate, supportsCodexReasoningUpdates } from "../adapter/reasoning-updates.ts";
import { projectCodexReasoningHistory } from "../adapter/reasoning-history.ts";
import { createAutoReasoning } from "../adapter/auto-reasoning.ts";

export type CodexContext = ExtensionContext;

export type CodexPrewarmResult =
	| { status: "ready"; usage?: CodexPrewarmUsage | undefined; socketReused?: boolean | undefined }
	| { status: "skipped" }
	| { status: "aborted" }
	| { status: "failed"; error: Error };

interface PreparedKeepaliveRequest {
	identity: string;
	baseUrl: string;
	accountId: string;
	body: ResponsesBody;
	responsesLite: boolean;
	headers: OpenAICodexStreamOptions["headers"];
	transport: OpenAICodexStreamOptions["transport"];
}

export interface CodexExtensionRuntime {
	autoReasoning: ReturnType<typeof createAutoReasoning>;
	state: AdapterState;
	tracker: ReturnType<typeof createExecCommandTracker>;
	sessions: ReturnType<typeof createExecSessionManager>;
	backgroundWidget: BackgroundBashWidgetState;
	voice: CodexVoiceController;
	lanVoice: CodexLanVoiceServerController;
	projectContextMessages(ctx: CodexContext, messages?: readonly AgentMessage[]): AgentMessage[];
	execEnv(config?: CodexConversionConfig): NodeJS.ProcessEnv;
	prepareTurn(ctx: CodexContext): void;
	finishTurn(): void;
	beforeRequestSend(model: Model<Api>, context: TranscriptContext, body: ResponsesBody, options: OpenAICodexStreamOptions | undefined, responsesLite: boolean): Promise<void>;
	startCompactionPrewarm(ctx: CodexContext): Promise<CodexPrewarmResult> | undefined;
	startKeepalivePrewarm(ctx: CodexContext): Promise<CodexPrewarmResult> | undefined;
	armCacheKeepalive(ctx: CodexContext): void;
	cancelCacheKeepalive(): void;
	resetTransport(sessionId?: string): void;
	resetTransportAfterCompaction(sessionId: string): void;
	shutdownTransport(sessionId: string): void;
	configureDiagnostics(ctx: CodexContext, announceLog?: boolean): Promise<void>;
	diagnosticsSink(): CodexDiagnosticsSink | undefined;
	shutdownDiagnostics(): Promise<void>;
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
	const voice = new CodexVoiceController(pi);
	const contextWindows = new CodexContextWindowManager(undefined, async (ctx, options) => {
		voice.announceContextTransition("rollover");
		await voice.refreshRealtimeContext(ctx, state.config, options);
	});
	const contextKickoff = new CodexContextWindowKickoff(contextWindows, (input) => {
		// Extension kickoffs bypass ordinary voice input routing, including after call replacement.
		const text = typeof input === "string" ? input : input
			.flatMap((part) => part.type === "text" ? [part.text] : [])
			.join("\n");
		voice.piInput(text.trim() ? text : "Continue.");
	});
	const state: AdapterState = {
		enabled: false,
		cwd: process.cwd(),
		promptSkills: [],
		config: initialConfig,
		executionMode: initialConfig.executionMode,
		codexTurnState: createCodexTurnState(),
		developerMessages: new CodexDeveloperMessageBridge(),
		contextWindows,
		contextKickoff,
		contextTree: new CodexContextTreeCoordinator(contextWindows, contextKickoff),
	};
	const tracker = createExecCommandTracker();
	const sessions = createExecSessionManager({
		env: { ...process.env },
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
	let requestContext: CodexContext | undefined;
	let ordinaryPrewarmPending = false;
	let preparedKeepaliveRequest: PreparedKeepaliveRequest | undefined;
	const diagnostics = createLazyCodexDiagnostics();
	let cacheEnvironmentWarningsReported = false;
	const requestIdentity = (ctx: CodexContext) => JSON.stringify({
		sessionId: ctx.sessionManager.getSessionId(),
		model: ctx.model,
		reasoning: pi.getThinkingLevel(),
		openai: state.config.openai,
		compaction: state.config.compaction,
		executionMode: state.executionMode,
	});
	const buildPrewarmPlan = (
		ctx: CodexContext,
		messages: Context["messages"],
		promptCacheRefresh = false,
	) => {
		const model = ctx.model;
		const config = structuredClone(state.config);
		const executionMode = state.executionMode;
		const runtimePlan = resolveCodexRuntimePlanForState(ctx, { ...state, config, executionMode });
		if (
			!model
			|| !runtimePlan.codexTransport
			|| !isAdapterRuntime(runtimePlan)
			|| (!promptCacheRefresh && !config.openai.forceCachedWebSockets)
		) return undefined;
		// A non-generating warmup must not consume an update before the next
		// response, otherwise more selector presses could rewrite its sent tail.
		if (supportsCodexReasoningUpdates(model) && hasPendingCodexReasoningUpdate(projectContextMessages(ctx))) return undefined;
		// Reconnects replay committed transcript state, never a freshly flattened
		// prompt that has not passed through the complete extension chain.
		if (!promptCacheRefresh && !getCurrentSystemMessage(messages)) return undefined;
		const reasoning = prewarmReasoningOption(pi.getThinkingLevel());
		const identity = requestIdentity(ctx);
		const key = JSON.stringify({
			identity,
			messages,
		});
		return {
			model,
			config,
			executionMode,
			reasoning,
			identity,
			key,
		};
	};
	const startPrewarm = (
		ctx: CodexContext,
		messages: Context["messages"],
		force = false,
		kind: "ordinary" | "compaction" | "keepalive" = "ordinary",
		preserveContinuation = false,
		keepaliveStrategy?: CodexCacheKeepaliveStrategy,
		requestSource?: "captured" | "reconstructed",
		generate = false,
		preparedRequest?: PreparedKeepaliveRequest,
	): Promise<CodexPrewarmResult> | undefined => {
		const plan = buildPrewarmPlan(ctx, messages, kind === "keepalive");
		if (!plan) return undefined;
		const { model, config, executionMode, reasoning, key: requestKey } = plan;
		const prewarmKey = JSON.stringify({ requestKey, preserveContinuation, generate, body: preparedRequest?.body });
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
				if (preparedRequest && (
					preparedRequest.identity !== requestIdentity(ctx)
					|| preparedRequest.baseUrl !== requestModel.baseUrl.replace(/\/+$/, "")
					|| preparedRequest.accountId !== extractAccountId(auth.apiKey)
				)) return { status: "skipped" } as const;
				const options: OpenAICodexStreamOptions = {
					apiKey: auth.apiKey,
					headers: { ...auth.headers, ...preparedRequest?.headers },
					...(auth.env ? { env: auth.env } : {}),
					...(preparedRequest?.transport ? { transport: preparedRequest.transport } : {}),
					sessionId: ctx.sessionManager.getSessionId(),
					signal: controller.signal,
					...reasoning,
					textVerbosity: config.openai.verbosity,
					...(config.openai.fast ? { serviceTier: "priority" as const } : {}),
				};
				const deps = {
					getConfig: () => ({ executionMode, openai: config.openai, compaction: config.compaction }),
					useResponsesLite: (currentModel: Model<Api>) => resolveCodexRuntimePlanForState({ model: currentModel }, { ...state, config, executionMode }).transport === "responses-lite",
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
				};
				const transportSettlement = preparedRequest
					? prewarmPreparedOpenAICodexWebSocket(requestModel, structuredClone(preparedRequest.body), options, preparedRequest.responsesLite, deps)
					: prewarmOpenAICodexWebSocket(requestModel, { messages }, {
						...options,
						onPayload: (body) => rewriteCodexProviderRequest(body, ctx, { ...state, config, executionMode }),
					}, deps);
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

	const projectContextMessages = (ctx: CodexContext, messages?: readonly AgentMessage[]) => {
		const plan = resolveCodexRuntimePlanForState(ctx, state);
		const branch = ctx.sessionManager.getBranch();
		const allEntries = plan.contextManagementMode === "tree" ? ctx.sessionManager.getEntries() : branch;
		const checkpointBranch = plan.contextManagementMode === "tree" && plan.contextManagementHybrid
			? projectTreeCheckpointBranch(branch, allEntries) : branch;
		const projected = state.contextWindows.project(
			projectCodexReasoningHistory(checkpointBranch, projectTreeCheckpointMessages(branch, checkpointBranch, messages)),
			plan.contextManagementMode,
			branch,
			allEntries,
			plan.contextManagementHybrid,
		);
		return projected.filter((message) => !isProviderContextExcludedMessage(message));
	};

	const currentMessages = (ctx: CodexContext) => {
		return convertToLlm(
			state.developerMessages.prepare(
				projectContextMessages(ctx),
				supportsCodexDeveloperMessages(ctx, state),
				ctx.model,
			),
		);
	};

	const currentContextPrewarm = (ctx: CodexContext, kind: "compaction" | "keepalive") => {
		const keepalivePlan = kind === "keepalive"
			? resolveCodexCacheKeepalivePlan(ctx.model?.id, state.config.openai)
			: undefined;
		const captured = kind === "keepalive" ? preparedKeepaliveRequest : undefined;
		if (kind === "keepalive" && (!keepalivePlan || !captured || captured.identity !== requestIdentity(ctx))) return undefined;
		const preserveContinuation = kind === "keepalive";
		return startPrewarm(
			ctx,
			captured ? [] : currentMessages(ctx),
			kind === "keepalive",
			kind,
			preserveContinuation,
			keepalivePlan?.strategy,
			kind === "keepalive" ? "captured" : undefined,
			keepalivePlan?.strategy === "generated-current",
			captured,
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
			const requestSource = "captured";
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
		autoReasoning: createAutoReasoning(pi, state),
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
		execEnv(_config = state.config) {
			return { ...process.env };
		},
		projectContextMessages,
		prepareTurn(ctx) {
			requestContext = ctx;
			ordinaryPrewarmPending = true;
		},
		finishTurn() {
			requestContext = undefined;
			ordinaryPrewarmPending = false;
		},
		async beforeRequestSend(model, context, body, options, responsesLite) {
			const ctx = requestContext;
			if (!ctx || options?.sessionId !== ctx.sessionManager.getSessionId()
				|| model.provider !== ctx.model?.provider || model.api !== ctx.model.api || model.id !== ctx.model.id
				|| options.canonicalCompaction || options.cacheRetention === "none") return;
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			if (!isAdapterRuntime(plan)) return;
			const systemMessage = getCurrentSystemMessage(context.messages);
			if (systemMessage) {
				state.preparedPrompt = {
					sessionId: options.sessionId,
					provider: model.provider, api: model.api, model: model.id,
					baseUrl: model.baseUrl.replace(/\/+$/, ""),
					executionMode: state.executionMode,
					transport: responsesLite ? "responses-lite" : "responses",
					systemMessage: structuredClone(systemMessage),
				};
			}
			// Preserve every extension's final serialization, not just our own
			// reconstruction. This prefix deliberately excludes the generated tail.
			preparedKeepaliveRequest = plan.codexTransport && options.apiKey && !body.previous_response_id
				&& resolveCodexCacheKeepalivePlan(model.id, state.config.openai)
				? {
					identity: requestIdentity(ctx),
					baseUrl: model.baseUrl.replace(/\/+$/, ""),
					accountId: extractAccountId(options.apiKey),
					body: structuredClone(body), responsesLite,
					headers: options.headers ? { ...options.headers } : undefined,
					transport: options.transport,
				} : undefined;
			if (!ordinaryPrewarmPending) return;
			ordinaryPrewarmPending = false;
			if (!plan.codexTransport || !state.config.openai.forceCachedWebSockets) return;
			prewarmController?.abort();
			const controller = new AbortController();
			prewarmController = controller;
			activePrewarmKind = "ordinary";
			try {
				await prewarmTransportSettlement?.catch(() => undefined);
				if (controller.signal.aborted) return;
				const operation = prewarmPreparedOpenAICodexWebSocket(model, body, {
					...options,
					signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
				}, responsesLite, {
					getConfig: () => ({ executionMode: state.executionMode, openai: state.config.openai, compaction: state.config.compaction }),
					turnState: state.codexTurnState,
					getDiagnostics: () => diagnostics.sink(),
					prewarmDiagnostics: { kind: "ordinary", requestSource: "captured" },
				});
				prewarmTransportSettlement = operation;
				try { await operation; }
				finally { if (prewarmTransportSettlement === operation) prewarmTransportSettlement = undefined; }
			} catch (error) {
				if (!controller.signal.aborted && !options.signal?.aborted)
					ctx.ui.notify(`Codex WebSocket prewarm failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			} finally {
				if (prewarmController === controller) {
					prewarmController = undefined;
					activePrewarmKind = undefined;
				}
			}
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
			requestContext = undefined;
			ordinaryPrewarmPending = false;
			state.preparedPrompt = undefined;
			preparedKeepaliveRequest = undefined;
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
