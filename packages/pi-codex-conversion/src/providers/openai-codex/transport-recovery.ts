import { createCodexRequestTiming, type CodexAttemptTiming } from "./diagnostic-timing.ts";
import { codexRequestDiagnostics } from "./diagnostic-request.ts";
import { readServiceTier } from "./usage.ts";
import { resolveDaybreakAccess } from "./daybreak.ts";
import {
	appendAssistantMessageDiagnostic,
	createAssistantMessageDiagnostic,
	createAssistantMessageEventStream,
	getDeclaredTools,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Model,
	type TranscriptContext,
	type Transport,
} from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { nativeCompactionConfigured } from "../../adapter/activation/runtime-plan.ts";
import { createGrammarToolInputProperties } from "../constrained-sampling.ts";
import { DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS, DEFAULT_SSE_HEADER_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_STREAM_MAX_RETRIES, DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS, MAX_WEBSOCKET_RECOVERY_RETRIES, INITIAL_STREAM_RETRY_DELAY_MS, MAX_SSE_REQUEST_RETRIES, MAX_STREAM_MAX_RETRIES } from "./constants.ts";
import { codexRetryAfterDeadline, createErrorMessage, isRetryableRequestStatus, NonRetryableProviderError, parseErrorResponse } from "./errors.ts";
import { buildSSEHeaders, buildWebSocketHeaders, createCodexRequestId, extractAccountId, headersToRecord, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexUrl, resolveCodexWebSocketUrl } from "./headers.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";
import { supportsResponsesLiteModel } from "./responses-lite-model.ts";
import { resolveCodexTranscript } from "./request-body.ts";
import { serializeCodexRequest } from "./request-serialization.ts";
import { applyResponsesLiteWebSocketMetadata } from "./responses-lite.ts";
import { combineAbortSignals, compressRequestBodyZstd, createSSEHeaderTimeout, normalizeTimeoutMs, parseSSE, sleep } from "./sse.ts";
import { assertSuccessfulCodexOutput, CodexProtocolError, codexOverloadRetryDelay, codexStreamRetryDelay, createCodexHttpError, isCodexApiError, isCodexOverloadError, isCodexRateLimitError, isRetryableCodexStreamError, processCodexResponsesStream } from "./stream-events.ts";
import { CODEX_TURN_STATE_HEADER, type CodexTurnState, withCodexTurnState, withCodexTurnStateHeader } from "./turn-state.ts";
import type { BeforeCodexRequestSend, CanonicalHistoryDecision, CodexDiagnosticsLane, CodexDiagnosticsSink, CodexProviderStreamOptions, CodexUsageRecorder, OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import { createInitialAssistantMessage } from "./types.ts";
import { finalizeUsage } from "./usage.ts";
import { isWebSocketSseFallbackActive, recordWebSocketSseFallback, validateWebSocketTimeoutOptions } from "./websocket.ts";
import { isPermanentWebSocketError, isWebSocketConnectionError, isWebSocketMessageTooBigError, isWebSocketUnauthorizedError, isWebSocketUpgradeRequiredError } from "./websocket-connection.ts";
import { processWebSocketStream } from "./websocket-stream.ts";
import { hasRemoteCompactionV2Input, withRemoteCompactionV2Feature } from "../openai-responses/compaction-v2-feature.ts";
import { captureCanonicalSessionToken, recordCanonicalSessionResponse, validateCanonicalSessionRequest } from "./session-continuity.ts";
import { preconnectWebSocket } from "./websocket-session-cache.ts";
import { osInfoReady } from "./node-runtime.ts";

export type CodexProviderRuntimeConfig = Pick<CodexConversionConfig, "openai" | "executionMode"> & Partial<Pick<CodexConversionConfig, "compaction">>;

export interface CodexTransportRecoveryDependencies {
	getConfig?: () => CodexProviderRuntimeConfig | undefined;
	useResponsesLite?: (model: Model<Api>) => boolean;
	turnState?: CodexTurnState | undefined;
	onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
	beforeRequestSend?: BeforeCodexRequestSend | undefined;
	onStreamSettled?: () => void | undefined;
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
	recordUsage?: CodexUsageRecorder | undefined;
	prepareRequestBody: <TApi extends Api>(
		model: Model<TApi>,
		context: TranscriptContext,
		options: OpenAICodexStreamOptions | undefined,
		responsesLite: boolean,
	) => Promise<ResponsesBody>;
}

function diagnosticsLane(body: ResponsesBody): Exclude<CodexDiagnosticsLane, "prewarm"> {
	return body.input.some((item) =>
		item && typeof item === "object" && (item as { type?: unknown }).type === "compaction_trigger"
	) ? "compaction" : "response";
}

function recordUsage(
	record: CodexDiagnosticsSink | undefined,
	lane: Exclude<CodexDiagnosticsLane, "prewarm">,
	transport: "websocket" | "sse",
	output: AssistantMessage,
): void {
	record?.({
		type: "usage",
		lane,
		transport,
		inputTokens: output.usage.input,
		cachedInputTokens: output.usage.cacheRead,
		cacheWriteInputTokens: output.usage.cacheWrite,
		outputTokens: output.usage.output,
	});
}

function codexStreamRetryDelayMs(retryCount: number): number {
	const base = INITIAL_STREAM_RETRY_DELAY_MS * 2 ** Math.max(0, retryCount - 1);
	return Math.min(DEFAULT_MAX_RETRY_DELAY_MS, base * (0.9 + Math.random() * 0.2));
}

function codexStreamMaxRetries(options: OpenAICodexStreamOptions | undefined): number {
	const configured = options?.maxRetries;
	if (configured === undefined) return DEFAULT_STREAM_MAX_RETRIES;
	if (!Number.isFinite(configured) || configured < 0) {
		throw new Error(`Invalid maxRetries: ${String(configured)}`);
	}
	return Math.min(Math.floor(configured), MAX_STREAM_MAX_RETRIES);
}

function retryAdviceRecoveryBudgetError(error: unknown): NonRetryableProviderError {
	const requestedDelayMs = codexStreamRetryDelay(error);
	const detail = requestedDelayMs === undefined ? "" : ` Provider requested a wait of ${Math.ceil(requestedDelayMs / 1000)} seconds.`;
	return new NonRetryableProviderError(`Codex retry delay exceeded the three-minute automatic recovery window.${detail}`);
}

export function getEffectiveCodexTransport(
	transport: Transport | undefined,
	config: Pick<CodexConversionConfig["openai"], "forceCachedWebSockets"> | undefined,
	sessionId?: string | undefined,
): Transport {
	const configuredTransport = transport ?? "auto";
	const preferredTransport = config?.forceCachedWebSockets !== false && configuredTransport === "websocket"
		? "websocket-cached"
		: configuredTransport;
	return preferredTransport !== "sse" && isWebSocketSseFallbackActive(sessionId) ? "sse" : preferredTransport;
}

async function openCodexSSE<TApi extends Api>(
	model: Model<TApi>,
	body: string | Uint8Array,
	baseHeaders: Headers,
	options: OpenAICodexStreamOptions | undefined,
	turnState: CodexTurnState | undefined,
	waitBeforeRetry: (error: unknown, retryCount: number) => Promise<void>,
	startAttempt: () => CodexAttemptTiming,
): Promise<Response> {
	let lastError: Error | undefined;
	const maxRetries = options?.maxRetries === undefined
		? MAX_SSE_REQUEST_RETRIES
		: Math.min(codexStreamMaxRetries(options), MAX_SSE_REQUEST_RETRIES);
	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		if (options?.signal?.aborted) throw new Error("Request was aborted");
		const timing = startAttempt();
		const headerTimeout = createSSEHeaderTimeout(DEFAULT_SSE_HEADER_TIMEOUT_MS);
		const combinedSignal = combineAbortSignals([options?.signal, headerTimeout.signal]);
		let response: Response;
		try {
			try {
				timing.sent();
				response = await (options?.fetch ?? fetch)(resolveCodexUrl(model.baseUrl), {
					method: "POST",
					headers: withCodexTurnStateHeader(baseHeaders, turnState),
					body,
					signal: combinedSignal.signal,
				});
			} catch (error) {
				const timeoutError = headerTimeout.error();
				throw timeoutError && !options?.signal?.aborted ? timeoutError : error;
			} finally {
				headerTimeout.clear();
			}
		} catch (error) {
			combinedSignal.cleanup();
			timing.finish(options?.signal?.aborted ? "aborted" : "failed");
			if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
				throw new Error("Request was aborted");
			}
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < maxRetries) {
				await waitBeforeRetry(lastError, attempt + 1);
				continue;
			}
			throw lastError;
		} finally {
			headerTimeout.clear();
		}

		try {
			const retryAfter = codexRetryAfterDeadline(response.headers);
			if (response.ok) turnState?.capture(response.headers.get(CODEX_TURN_STATE_HEADER));
			await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
			if (response.ok) return response;

			const info = await parseErrorResponse(response, combinedSignal.signal);
			const message = info.friendlyMessage || info.message;
			const error = createCodexHttpError(message, info.code, response.status, retryAfter);
			timing.finish("failed");
			if (isCodexOverloadError(error)) throw error;
			const requestRetryable = isRetryableRequestStatus(response.status) && isRetryableCodexStreamError(error);
			if (requestRetryable && attempt < maxRetries) {
				combinedSignal.cleanup();
				await waitBeforeRetry(error, attempt + 1);
				continue;
			}
			throw error;
		} finally {
			combinedSignal.cleanup();
		}
	}
	throw lastError ?? new Error("Failed after retries");
}

export function createCodexTransportStream<TApi extends Api>(
	model: Model<TApi>,
	context: TranscriptContext,
	options: CodexProviderStreamOptions | undefined,
	deps: CodexTransportRecoveryDependencies,
): AssistantMessageEventStream {
	const runtimeConfig = deps.getConfig?.();
	const responsesLite = deps.useResponsesLite?.(model)
		?? ((runtimeConfig?.executionMode === "code" || runtimeConfig?.executionMode === "notebook")
			&& supportsResponsesLiteModel(model.id));
	const resolvedContext = resolveCodexTranscript(model, context);
	const modelSupportsGrammarTools = (model.compat as { supportsOpenAIGrammarTools?: boolean | undefined } | undefined)
		?.supportsOpenAIGrammarTools ?? false;
	const grammarToolInputProperties = createGrammarToolInputProperties(
		getDeclaredTools(context.messages),
		responsesLite || modelSupportsGrammarTools,
	);
	const preferredTransport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai);
	const effectiveTransport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai, options?.sessionId);
	const effectiveOptions: OpenAICodexStreamOptions | undefined = options
		? {
			...options,
			transport: effectiveTransport,
			grammarToolInputProperties,
			...(nativeCompactionConfigured(runtimeConfig?.compaction) ? { headers: withRemoteCompactionV2Feature(options.headers) } : {}),
		}
		: { transport: effectiveTransport, grammarToolInputProperties };
	const stream = createAssistantMessageEventStream();

	(async () => {
		let output = createInitialAssistantMessage(model);
		const sink = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
		const requestTiming = createCodexRequestTiming(sink, undefined, effectiveOptions?.sessionId);
		const diagnostics: CodexDiagnosticsSink | undefined = sink ? event => sink({ ...event, requestId: requestTiming.requestId,
			sessionRequestOrdinal: requestTiming.sessionRequestOrdinal, requestCounterProcessId: requestTiming.requestCounterProcessId }) : undefined;
		let lane: Exclude<CodexDiagnosticsLane, "prewarm"> = "response";
		let diagnosticsFailureRecorded = false;
		let preconnect: ReturnType<typeof preconnectWebSocket> | undefined;
		let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
		const recordFailure = (transport: "websocket" | "sse", error: unknown) => {
			if (!diagnostics) return;
			diagnosticsFailureRecorded = true;
			diagnostics({ type: "failure", lane, transport, failure: codexDiagnosticsFailure(error) });
		};
		try {
			const apiKey = effectiveOptions?.apiKey;
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			const canonicalSessionToken = captureCanonicalSessionToken(effectiveOptions?.sessionId);
			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const originator = runtimeConfig?.openai.harnessIdentifierHeader === "codex" ? "codex_cli_rs"
				: runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi";
			// Pi has completed every before_agent_start/context hook. Only the
			// handshake overlaps payload rewrites and image preparation, never warmup.
			if (effectiveTransport !== "sse" && runtimeConfig?.openai.forceCachedWebSockets
				&& deps.beforeRequestSend && effectiveOptions.sessionId
				&& !effectiveOptions.canonicalCompaction && effectiveOptions.cacheRetention !== "none") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				// Do not let async OS discovery change the route's User-Agent mid-preparation.
				await osInfoReady;
				preconnect = preconnectWebSocket(
					resolveCodexWebSocketUrl(model.baseUrl),
					buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, apiKey, websocketRequestId, originator,
						{ model: model.id, service_tier: effectiveOptions.serviceTier ?? undefined }),
					effectiveOptions.sessionId, accountId, effectiveOptions.signal,
					normalizeTimeoutMs(effectiveOptions.websocketConnectTimeoutMs, "websocketConnectTimeoutMs"), effectiveOptions.env,
					(error) => diagnostics?.({ type: "failure", lane: "prewarm", transport: "websocket", failure: codexDiagnosticsFailure(error) }),
					diagnostics,
				);
			}
			const reconstructedBody = await deps.prepareRequestBody(model, resolvedContext, effectiveOptions, responsesLite);
			const body = reconstructedBody;
			if (hasRemoteCompactionV2Input(body.input)) effectiveOptions.headers = withRemoteCompactionV2Feature(effectiveOptions.headers);
			if (preconnect) {
				const finalHeaders = buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, apiKey, websocketRequestId, originator, body);
				const failure = await preconnect.handoff(resolveCodexWebSocketUrl(model.baseUrl), finalHeaders, accountId, effectiveOptions.env,
					getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai, options?.sessionId) !== "sse");
				if (failure && !(failure.error instanceof CodexProtocolError)
					&& (isWebSocketUpgradeRequiredError(failure.error) || isWebSocketMessageTooBigError(failure.error))) {
					recordWebSocketSseFallback(effectiveOptions.sessionId);
					diagnostics?.({ type: "fallback", lane: diagnosticsLane(body), from: "websocket", to: "sse",
						reason: isWebSocketUpgradeRequiredError(failure.error) ? "upgrade_required" : "message_too_big" });
				}
			}
			if (runtimeConfig) {
				const accessPrograms = await resolveDaybreakAccess(model, effectiveOptions, runtimeConfig.openai.daybreak, body.model, originator);
				delete body.access_programs;
				if (accessPrograms) body.access_programs = accessPrograms;
			}
			await deps.beforeRequestSend?.(model, resolvedContext, body, effectiveOptions, responsesLite);
			// Payload hooks own the final wire tier, including user-selected speed.
			effectiveOptions.serviceTier = readServiceTier(body.service_tier);
			const canonicalHistory: CanonicalHistoryDecision | undefined = effectiveOptions?.canonicalCompaction
				? "compaction"
				: validateCanonicalSessionRequest(
					effectiveOptions?.sessionId,
					resolveCodexWebSocketUrl(model.baseUrl),
					accountId,
					body,
				);
			lane = diagnosticsLane(body);
			deps.onPreparedPayload?.(body);
			const baseSseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId, responsesLite, originator, body);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId, originator, body);
			const bodyJson = serializeCodexRequest(body);
			const websocketBody = responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body;
			const compressedBody = compressRequestBodyZstd(bodyJson);
			if (compressedBody) baseSseHeaders.set("content-encoding", "zstd");
			const sseBody = compressedBody ?? bodyJson;
			// Final-body preparation may prewarm the main lane and discover a sticky
			// WebSocket incompatibility. Re-read session routing before the real send.
			const transport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai, options?.sessionId);
			const streamMaxRetries = codexStreamMaxRetries(effectiveOptions);
			let overloadRetryCount = 0;
			let overloadWaitedMs = 0;
			let retryAdviceWaitedMs = 0;
			const callerSignal = effectiveOptions?.signal;
			let recoveryDeadlineAt: number | undefined;
			let recoveryController: AbortController | undefined;
			let websocketRecoveryRetries = 0;
			const recoverySignal = () => recoveryController
				? combineAbortSignals([callerSignal, recoveryController.signal])
				: undefined;
			const startTransportRecovery = (freshWindow = false) => {
				if (freshWindow) {
					if (recoveryTimer) clearTimeout(recoveryTimer);
					recoveryDeadlineAt = undefined;
				}
				if (recoveryDeadlineAt !== undefined) return;
				// Never charge a long, healthy initial response against the recovery window.
				recoveryDeadlineAt = performance.now() + DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS;
				recoveryController = new AbortController();
				recoveryTimer = setTimeout(() => recoveryController?.abort(), DEFAULT_TRANSPORT_RECOVERY_BUDGET_MS);
			};
			const recoveryDeadlineError = () => new NonRetryableProviderError(
				"Codex could not complete transport recovery within five minutes; the request was stopped before an answer completed. Retry the request.",
			);
			const recoveryExpired = () => recoveryController?.signal.aborted === true
				|| (recoveryDeadlineAt !== undefined && performance.now() >= recoveryDeadlineAt);
			const planRetry = (error: unknown, retryCount: number) => {
				const overload = isCodexOverloadError(error);
				const requestedDelayMs = codexStreamRetryDelay(error);
				const serverDirected = requestedDelayMs !== undefined || isCodexRateLimitError(error);
				const fallbackDelayMs = codexStreamRetryDelayMs(retryCount);
				const delayMs = overload
					? codexOverloadRetryDelay(error, overloadRetryCount, overloadWaitedMs)
					: requestedDelayMs ?? fallbackDelayMs;
				const adviceBudgetExhausted = serverDirected && (delayMs === undefined
					|| delayMs > Math.max(0, DEFAULT_RATE_LIMIT_RECOVERY_BUDGET_MS - retryAdviceWaitedMs));
				return {
					overload,
					serverDirected,
					adviceBudgetExhausted,
					delayMs: adviceBudgetExhausted ? undefined : delayMs,
				};
			};
			const waitBeforeRetry = async (error: unknown, retryCount: number, plan = planRetry(error, retryCount), switchingOnExpiry = false) => {
				if (plan.delayMs === undefined) throw retryAdviceRecoveryBudgetError(error);
				// Hooks and diagnostics may take time. Expired advice means zero,
				// not another full delay or a fresh local backoff.
				const delayMs = codexStreamRetryDelay(error) ?? plan.delayMs;
				if (!switchingOnExpiry && recoveryDeadlineAt !== undefined && delayMs > Math.max(0, recoveryDeadlineAt - performance.now())) {
					throw new NonRetryableProviderError("Codex retry advice exceeds the remaining transport recovery window; retry the request later.");
				}
				const retrySignal = recoverySignal();
				try {
					await sleep(delayMs, retrySignal?.signal ?? callerSignal);
				} finally {
					retrySignal?.cleanup();
				}
				if (plan.overload) {
					overloadRetryCount++;
					overloadWaitedMs += delayMs;
				}
				if (plan.serverDirected) retryAdviceWaitedMs += delayMs;
			};

			let streamStarted = false;
			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
					if (attempt > 0) output = createInitialAssistantMessage(model);
					if (recoveryDeadlineAt !== undefined) websocketRecoveryRetries++;
					const attemptSignal = recoverySignal();
					const attemptOptions = attemptSignal ? { ...effectiveOptions, signal: attemptSignal.signal } : effectiveOptions;
					let websocketStarted = false;
					const timing = requestTiming.start(lane, "websocket");
					try {
						await processWebSocketStream(
							resolveCodexWebSocketUrl(model.baseUrl),
							withCodexTurnState(websocketBody, deps.turnState),
							websocketHeaders,
							output,
							stream,
							model,
							accountId,
							() => {
								websocketStarted = true;
								if (!streamStarted) {
									streamStarted = true;
									stream.push({ type: "start", partial: output });
								}
							},
							attemptOptions,
							deps.turnState,
							diagnostics ? { lane, attempt: timing.attempt, record: diagnostics, requestId: requestTiming.requestId, timing } : undefined,
							{
								reconstructedRequestBody: reconstructedBody,
								token: canonicalSessionToken,
								decision: canonicalHistory,
							},
						);
						if (callerSignal?.aborted) throw new Error("Request was aborted");
						if (recoveryExpired()) throw recoveryDeadlineError();
						finalizeUsage(output);
						assertSuccessfulCodexOutput(output);
						timing.finish("completed");
						recordUsage(diagnostics, lane, "websocket", output);
						await deps.recordUsage?.(accountId, { ...model, id: body.model }, output.usage);
						stream.push({ type: "done", reason: output.stopReason, message: output });
						return;
					} catch (error) {
						timing.finish(callerSignal?.aborted ? "aborted" : "failed");
						if (callerSignal?.aborted) throw error;
						const upgradeRequired = isWebSocketUpgradeRequiredError(error);
						const messageTooBig = isWebSocketMessageTooBigError(error);
						const unauthorized = isWebSocketUnauthorizedError(error);
						const retryableWebSocketError = (isCodexApiError(error) || !isPermanentWebSocketError(error)) && isRetryableCodexStreamError(error);
						const connectionFailure = !isCodexApiError(error) && isWebSocketConnectionError(error);
						if (retryableWebSocketError && connectionFailure) {
							startTransportRecovery();
						}
						const retryPlan = planRetry(error, attempt + 1);
						const websocketRecoveryExhausted = recoveryExpired()
							|| (retryableWebSocketError && (websocketRecoveryRetries >= MAX_WEBSOCKET_RECOVERY_RETRIES
								|| (recoveryDeadlineAt !== undefined && retryPlan.delayMs !== undefined
									&& retryPlan.delayMs >= recoveryDeadlineAt - performance.now())));
						const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
						const adviceBudgetExhausted = retryPlan.adviceBudgetExhausted;
						const immediateFallback = !(error instanceof CodexProtocolError) && (upgradeRequired || messageTooBig || unauthorized);
						const fallbackArmed = immediateFallback || websocketRecoveryExhausted
							|| (retryableWebSocketError && (attempt >= streamMaxRetries || overloadBudgetExhausted));
						appendAssistantMessageDiagnostic(
							output,
							createAssistantMessageDiagnostic(retryableWebSocketError ? "provider_transport_failure" : "provider_stream_failure", error, {
								configuredTransport: preferredTransport,
								...(fallbackArmed ? { fallbackTransport: "sse" } : {}),
								eventsEmitted: websocketStarted,
								phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
								requestBytes: new TextEncoder().encode(bodyJson).byteLength,
							}),
						);
						if (!immediateFallback && !websocketRecoveryExhausted
							&& retryableWebSocketError && attempt < streamMaxRetries && !overloadBudgetExhausted && !adviceBudgetExhausted) {
							diagnostics?.({
								type: "retry",
								lane,
								transport: "websocket",
								attempt: requestTiming.nextAttempt,
								...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
								failure: codexDiagnosticsFailure(error),
							});
							try {
								await waitBeforeRetry(error, attempt + 1, retryPlan, true);
								continue;
							} catch (waitError) {
								if (callerSignal?.aborted || !recoveryExpired()) throw waitError;
							}
						}
						if (adviceBudgetExhausted && retryableWebSocketError) {
							throw retryAdviceRecoveryBudgetError(error);
						}
						if (!fallbackArmed && !recoveryExpired()) {
							recordFailure("websocket", error);
							if (websocketStarted && !(error instanceof CodexProtocolError) && !isCodexApiError(error)) {
								throw new NonRetryableProviderError("Codex stream ended after output began and cannot be continued from its incomplete response.");
							}
							throw error;
						}
						// A transport switch is still another request to the same backend.
						// SSE gets its own bounded window, never the exhausted WebSocket signal.
						startTransportRecovery(true);
						if (!immediateFallback && retryPlan.serverDirected) await waitBeforeRetry(error, attempt + 1, retryPlan);
						// Pi supplies resolved request auth, not a force-refresh handle. Keep 401
						// fallback turn-local so refreshed auth can use WebSockets on the next turn.
						if (!unauthorized) recordWebSocketSseFallback(effectiveOptions?.sessionId);
						diagnostics?.({
							type: "fallback",
							lane,
							from: "websocket",
							to: "sse",
							reason: upgradeRequired
								? "upgrade_required"
								: messageTooBig
									? "message_too_big"
									: unauthorized
										? "unauthorized"
										: "retry_budget_exhausted",
						});
						output = createInitialAssistantMessage(model);
						break;
					} finally {
						attemptSignal?.cleanup();
					}
				}
			}

			// Preparation can discover incompatibility before the live WebSocket send.
			if (effectiveTransport !== "sse" && transport === "sse") startTransportRecovery();
			const sseIdleTimeoutMs = normalizeTimeoutMs(effectiveOptions?.timeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, "timeoutMs");
			for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
				if (attempt > 0) output = createInitialAssistantMessage(model);
				if (callerSignal?.aborted) throw new Error("Request was aborted");
				if (recoveryExpired()) throw recoveryDeadlineError();
				const sseSignal = recoverySignal();
				const sseOptions = sseSignal ? { ...effectiveOptions, signal: sseSignal.signal } : effectiveOptions;
				const responseItems: unknown[] = [];
				let timing: CodexAttemptTiming | undefined;
				try {
					if (effectiveOptions?.compactionDiagnostics) {
						Object.assign(effectiveOptions.compactionDiagnostics, {
							transport: "sse",
							continuation: undefined,
							continuationMismatch: undefined,
							previousResponseId: false,
							fullInputItems: body.input.length,
							sentInputItems: body.input.length,
						});
					}
					const response = await openCodexSSE(model, sseBody, baseSseHeaders, sseOptions, deps.turnState, async (error, retryCount) => {
						const plan = planRetry(error, retryCount);
						diagnostics?.({ type: "retry", lane, transport: "sse", attempt: requestTiming.nextAttempt,
							...(plan.delayMs !== undefined ? { delayMs: plan.delayMs } : {}), failure: codexDiagnosticsFailure(error) });
						await waitBeforeRetry(error, retryCount, plan);
					}, () => {
						timing = requestTiming.start(lane, "sse");
						diagnostics?.({
							type: "request",
							lane,
							transport: "sse",
							attempt: timing.attempt,
							requestMetadata: codexRequestDiagnostics(body, baseSseHeaders),
							fullInputItems: body.input.length,
							sentInputItems: body.input.length,
							model: body.model,
							...(canonicalHistory ? { canonicalHistory } : {}),
							...(effectiveOptions?.compactionDiagnostics ? { compaction: structuredClone(effectiveOptions.compactionDiagnostics) } : {}),
						});
						return timing;
					});
					if (!response.body) throw new Error("No response body");
					if (!streamStarted) {
						streamStarted = true;
						stream.push({ type: "start", partial: output });
					}
					await processCodexResponsesStream(
						parseSSE(response, sseOptions?.signal, sseIdleTimeoutMs),
						output,
						stream,
						model,
						{
							...sseOptions,
							onOutputItemDone: (item) => responseItems.push(item),
							onProviderStreamEvent: (event, eventModel) => {
								timing?.observe(event);
								return effectiveOptions?.onProviderStreamEvent?.(event, eventModel);
							},
						},
					);
					finalizeUsage(output);
					if (callerSignal?.aborted) throw new Error("Request was aborted");
					if (recoveryExpired()) {
						const error = recoveryDeadlineError();
						recordFailure("sse", error);
						throw error;
					}
					assertSuccessfulCodexOutput(output);
					timing?.finish("completed");
					recordUsage(diagnostics, lane, "sse", output);
					await deps.recordUsage?.(accountId, { ...model, id: body.model }, output.usage);
					for (const item of responseItems) effectiveOptions?.onOutputItemDone?.(item);
					if (!effectiveOptions?.canonicalCompaction) recordCanonicalSessionResponse({
						sessionId: effectiveOptions?.sessionId,
						url: resolveCodexWebSocketUrl(model.baseUrl),
						accountId,
						requestBody: body,
						reconstructedRequestBody: reconstructedBody,
						responseItems,
						token: canonicalSessionToken,
					});
					stream.push({ type: "done", reason: output.stopReason, message: output });
					return;
				} catch (error) {
					timing?.finish(callerSignal?.aborted ? "aborted" : "failed");
					if (callerSignal?.aborted) throw error;
					if (recoveryExpired()) {
						const deadlineError = recoveryDeadlineError();
						recordFailure("sse", deadlineError);
						throw deadlineError;
					}
					const retryable = !(error instanceof NonRetryableProviderError) && isRetryableCodexStreamError(error);
					const retryPlan = planRetry(error, attempt + 1);
					const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
					const adviceBudgetExhausted = retryPlan.adviceBudgetExhausted;
					appendAssistantMessageDiagnostic(
						output,
						createAssistantMessageDiagnostic(retryable ? "provider_transport_failure" : "provider_stream_failure", error, {
							configuredTransport: preferredTransport,
							eventsEmitted: output.content.length > 0,
							phase: output.content.length > 0 ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(bodyJson).byteLength,
						}),
					);
					if (retryable && attempt < streamMaxRetries && !overloadBudgetExhausted && !adviceBudgetExhausted) {
						diagnostics?.({
							type: "retry",
							lane,
							transport: "sse",
							attempt: requestTiming.nextAttempt,
							...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
							failure: codexDiagnosticsFailure(error),
						});
						await waitBeforeRetry(error, attempt + 1, retryPlan);
						continue;
					}
					if (adviceBudgetExhausted && retryable) {
						throw retryAdviceRecoveryBudgetError(error);
					}
					recordFailure("sse", error);
					if (retryable && recoveryDeadlineAt !== undefined) {
						throw new NonRetryableProviderError("Codex WebSocket recovery and SSE fallback did not complete a response. Retry the request.");
					}
					if (retryable) throw new NonRetryableProviderError("Codex stream retry budget was exhausted before a response completed.");
					throw error;
				} finally {
					sseSignal?.cleanup();
				}
			}
		} catch (error) {
			if (!diagnosticsFailureRecorded) recordFailure(effectiveTransport === "sse" ? "sse" : "websocket", error);
			output.content = output.content.filter(block => block.type !== "toolCall");
			stream.push({
				type: "error",
				reason: (effectiveOptions?.signal?.aborted ? "aborted" : "error") as "aborted" | "error",
				error: createErrorMessage(output, error, !!effectiveOptions?.signal?.aborted),
			});
		} finally {
			if (recoveryTimer) clearTimeout(recoveryTimer);
			await preconnect?.close();
			deps.onStreamSettled?.();
		}
	})();

	return stream;
}
