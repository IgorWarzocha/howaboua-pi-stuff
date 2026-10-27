import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getCurrentSystemMessage, type Api, type Model, type TranscriptContext } from "@earendil-works/pi-ai";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { resolveFastModeServiceTier } from "../../adapter/activation/fast-mode.ts";
import { resolveDaybreakAccess } from "../../providers/openai-codex/daybreak.ts";
import { resolveCodexCacheKeepalivePlan, type CodexCacheKeepaliveStrategy } from "../../adapter/activation/cache-keepalive.ts";
import { isAdapterRuntime, resolveCodexRuntimePlanForState } from "../../adapter/activation/runtime-plan.ts";
import type { AdapterState } from "../../adapter/activation/state.ts";
import { rewriteCodexProviderHeaders } from "../../adapter/provider-request.ts";
import { closeOpenAICodexKeepaliveWebSocketSession, closeOpenAICodexWebSocketSessions, prewarmPreparedOpenAICodexWebSocket } from "../../providers/openai-codex-custom-provider.ts";
import { resetOpenAICodexWebSocketSessions } from "../../providers/openai-codex/websocket.ts";
import { extractAccountId, PI_CODEX_CONVERSION_ORIGINATOR } from "../../providers/openai-codex/headers.ts";
import type { CodexUsageRecorder, OpenAICodexStreamOptions, ResponsesBody } from "../../providers/openai-codex/types.ts";
import type { createLazyCodexDiagnostics } from "../../diagnostics/lazy.ts";
import { validateRemoteOutputReplay } from "../../tools/code-mode/protected-output.ts";
import { hasPendingCodexReasoningUpdate, supportsCodexReasoningUpdates } from "../../adapter/reasoning-updates.ts";
import { priceGeneratedPrewarm } from "../../providers/openai-codex/usage.ts";
import type { CodexContext, CodexExtensionRuntime, CodexPrewarmResult } from "../runtime.ts";
import { createCacheKeepaliveScheduler } from "./keepalive-scheduler.ts";

interface PreparedKeepaliveRequest {
	identity: string;
	baseUrl: string;
	accountId: string;
	body: ResponsesBody;
	responsesLite: boolean;
	headers: OpenAICodexStreamOptions["headers"];
}

function prewarmReasoningOption(level: ReturnType<ExtensionAPI["getThinkingLevel"]>): Pick<OpenAICodexStreamOptions, "reasoning"> | Record<never, never> {
	return level === "off" ? {} : { reasoning: level };
}

export function createCodexExtensionTransport(
	pi: ExtensionAPI,
	state: AdapterState,
	diagnostics: ReturnType<typeof createLazyCodexDiagnostics>,
	projectContextMessages: (ctx: CodexContext, messages?: readonly AgentMessage[]) => AgentMessage[],
	recordUsage?: CodexUsageRecorder,
) {
	let prewarmController: AbortController | undefined;
	let prewarmPromise: Promise<CodexPrewarmResult> | undefined;
	let prewarmTransportSettlement: Promise<unknown> | undefined;
	let pendingPrewarmKey: string | undefined;
	let activePrewarmKind: "ordinary" | "keepalive" | undefined;
	let requestContext: CodexContext | undefined;
	let ordinaryPrewarmPending = false;
	let preparedKeepaliveRequest: PreparedKeepaliveRequest | undefined;
	const validateRemoteRequest = async (
		ctx: CodexContext | undefined, model: Model<Api>, context: Pick<TranscriptContext, "messages">,
		body: ResponsesBody, options: OpenAICodexStreamOptions | undefined, responsesLite: boolean,
	): Promise<void> => {
		const account = () => options?.apiKey ? extractAccountId(options.apiKey) : undefined;
		validateRemoteOutputReplay(context.messages, account, ctx, model.baseUrl);
		await state.developerMessages.validateRemotePayload(body, account, ctx, responsesLite, model.baseUrl);
	};
	const requestIdentity = (ctx: CodexContext) => JSON.stringify({
		sessionId: ctx.sessionManager.getSessionId(),
		model: ctx.model,
		reasoning: pi.getThinkingLevel(),
		openai: state.config.openai,
		compaction: state.config.compaction,
		executionMode: state.executionMode,
	});
	const buildPrewarmPlan = (ctx: CodexContext) => {
		const model = ctx.model;
		const config = structuredClone(state.config);
		const executionMode = state.executionMode;
		const runtimePlan = resolveCodexRuntimePlanForState(ctx, { ...state, config, executionMode });
		if (
			!model
			|| !runtimePlan.codexTransport
			|| !isAdapterRuntime(runtimePlan)
		) return undefined;
		// A non-generating warmup must not consume an update before the next
		// response, otherwise more selector presses could rewrite its sent tail.
		if (supportsCodexReasoningUpdates(model) && hasPendingCodexReasoningUpdate(projectContextMessages(ctx))) return undefined;
		const reasoning = prewarmReasoningOption(pi.getThinkingLevel());
		const identity = requestIdentity(ctx);
		return {
			model,
			config,
			executionMode,
			reasoning,
			identity,
			key: identity,
		};
	};
	const startPrewarm = (
		ctx: CodexContext,
		keepaliveStrategy: CodexCacheKeepaliveStrategy,
		preparedRequest: PreparedKeepaliveRequest,
	): Promise<CodexPrewarmResult> | undefined => {
		const plan = buildPrewarmPlan(ctx);
		if (!plan) return undefined;
		const generate = keepaliveStrategy === "generated-current";
		const { model, config, executionMode, reasoning, key: requestKey } = plan;
		const prewarmKey = JSON.stringify({ requestKey, generate, body: preparedRequest.body });
		if (pendingPrewarmKey === prewarmKey) return prewarmPromise;
		const previousTransportSettlement = prewarmTransportSettlement;
		prewarmController?.abort();
		const controller = new AbortController();
		prewarmController = controller;
		activePrewarmKind = "keepalive";
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
				if (
					preparedRequest.identity !== requestIdentity(ctx)
					|| preparedRequest.baseUrl !== requestModel.baseUrl.replace(/\/+$/, "")
					|| preparedRequest.accountId !== extractAccountId(auth.apiKey)
				) return { status: "skipped" } as const;
				const options: OpenAICodexStreamOptions = {
					apiKey: auth.apiKey,
					headers: { ...auth.headers, ...preparedRequest.headers },
					...(auth.env ? { env: auth.env } : {}),
					transport: pi.getSettings().transport ?? "auto",
					sessionId: ctx.sessionManager.getSessionId(),
					signal: controller.signal,
					...reasoning,
					textVerbosity: config.openai.verbosity,
					serviceTier: resolveFastModeServiceTier(config.openai.fast, model.id),
				};
				rewriteCodexProviderHeaders(options.headers!, ctx, { ...state, config, executionMode });
				const originator = config.openai.harnessIdentifierHeader === "codex" ? "codex_cli_rs"
					: config.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi";
				options.accessPrograms = await resolveDaybreakAccess(requestModel, options, config.openai.daybreak, preparedRequest.body.model, originator);
				const deps = {
					validateRequest: (body: ResponsesBody, responsesLite: boolean) =>
						validateRemoteRequest(ctx, requestModel, { messages: [] }, body, options, responsesLite),
					getConfig: () => ({ executionMode, openai: config.openai, compaction: config.compaction }),
					useResponsesLite: (currentModel: Model<Api>) => resolveCodexRuntimePlanForState({ model: currentModel }, { ...state, config, executionMode }).transport === "responses-lite",
					turnState: state.codexTurnState,
					getDiagnostics: () => diagnostics.sink(),
					preserveContinuation: true,
					prewarmDiagnostics: {
						kind: "keepalive" as const,
						keepaliveStrategy,
						requestSource: "captured" as const,
					},
					...(generate ? { generate: true } : {}),
				};
				const preparedBody = structuredClone(preparedRequest.body);
				delete preparedBody.service_tier;
				delete preparedBody.access_programs;
				if (options.serviceTier) preparedBody.service_tier = options.serviceTier;
				if (options.accessPrograms) preparedBody.access_programs = options.accessPrograms;
				preparedBody.text = { ...preparedBody.text, verbosity: config.openai.verbosity };
				const transportSettlement = prewarmPreparedOpenAICodexWebSocket(requestModel, preparedBody, options, preparedRequest.responsesLite, deps);
				prewarmTransportSettlement = transportSettlement;
				try {
					const result = await transportSettlement;
					if (generate && result?.usage) {
						await recordUsage?.(extractAccountId(auth.apiKey), requestModel, priceGeneratedPrewarm(model, result.usage, options.serviceTier));
					}
					if (controller.signal.aborted) return { status: "aborted" } as const;
					if (!result) return { status: "skipped" } as const;
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

	const currentContextPrewarm = (ctx: CodexContext) => {
		const keepalivePlan = resolveCodexCacheKeepalivePlan(ctx.model?.id, state.config.openai);
		const captured = preparedKeepaliveRequest;
		if (!keepalivePlan || !captured || captured.identity !== requestIdentity(ctx)) return undefined;
		return startPrewarm(
			ctx,
			keepalivePlan.strategy,
			captured,
		);
	};

	const keepalive = createCacheKeepaliveScheduler(state, currentContextPrewarm, () => {
		if (activePrewarmKind === "keepalive") prewarmController?.abort();
	}, diagnostics);
	const cancelCacheKeepalive = keepalive.cancel;
	const armCacheKeepalive = keepalive.arm;

	const runtime = {
		prepareTurn(ctx) {
			requestContext = ctx;
			ordinaryPrewarmPending = true;
		},
		suspendOrdinaryPrewarm() {
			ordinaryPrewarmPending = false;
		},
		finishTurn() {
			requestContext = undefined;
			ordinaryPrewarmPending = false;
		},
		async beforeRequestSend(model, context, body, options, responsesLite) {
			const ctx = options?.remoteDeliveryContext ?? (options?.canonicalCompaction ? undefined : requestContext);
			await validateRemoteRequest(ctx, model, context, body, options, responsesLite);
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
				} : undefined;
			if (!ordinaryPrewarmPending) return;
			ordinaryPrewarmPending = false;
			if (!plan.codexTransport) return;
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
					validateRequest: (prepared, lite) => validateRemoteRequest(ctx, model, context, prepared, options, lite),
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
		startKeepalivePrewarm(ctx) {
			return currentContextPrewarm(ctx);
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
			state.replayCompaction = undefined;
			preparedKeepaliveRequest = undefined;
			prewarmController?.abort();
			prewarmController = undefined;
			pendingPrewarmKey = undefined;
			state.codexTurnState.reset();
			if (sessionId) {
				resetOpenAICodexWebSocketSessions(sessionId);
				closeOpenAICodexKeepaliveWebSocketSession(sessionId);
			} else closeOpenAICodexWebSocketSessions();
		},
		resetTransportForContextWindow(sessionId) {
			const continuingContext = requestContext;
			runtime.resetTransport(sessionId);
			if (continuingContext?.sessionManager.getSessionId() === sessionId)
				requestContext = continuingContext;
			closeOpenAICodexWebSocketSessions(sessionId);
		},
		shutdownTransport(sessionId) {
			cancelCacheKeepalive();
			runtime.resetTransport(sessionId);
			closeOpenAICodexWebSocketSessions(sessionId);
		},
	} satisfies Pick<CodexExtensionRuntime, "prepareTurn" | "suspendOrdinaryPrewarm" | "finishTurn" | "beforeRequestSend" | "startKeepalivePrewarm" | "armCacheKeepalive" | "cancelCacheKeepalive" | "resetTransport" | "resetTransportForContextWindow" | "shutdownTransport">;
	return runtime;
}
