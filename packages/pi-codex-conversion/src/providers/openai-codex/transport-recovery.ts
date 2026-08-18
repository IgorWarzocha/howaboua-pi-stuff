import {
	appendAssistantMessageDiagnostic,
	createAssistantMessageDiagnostic,
	createAssistantMessageEventStream,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type Transport,
} from "@earendil-works/pi-ai";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { createGrammarToolInputProperties } from "../constrained-sampling.ts";
import { DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_SSE_HEADER_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_STREAM_MAX_RETRIES, INITIAL_STREAM_RETRY_DELAY_MS, MAX_SSE_REQUEST_RETRIES, MAX_STREAM_MAX_RETRIES } from "./constants.ts";
import { createErrorMessage, isRetryableRequestStatus, isRetryableStreamStatus, NonRetryableProviderError, parseErrorResponse } from "./errors.ts";
import { buildSSEHeaders, buildWebSocketHeaders, createCodexRequestId, extractAccountId, headersToRecord, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexRequestRouting, resolveCodexUrl, resolveCodexWebSocketUrl } from "./headers.ts";
import { codexDiagnosticsFailure, noThrowCodexDiagnosticsSink } from "./diagnostic-failure.ts";
import { supportsResponsesLiteModel } from "./responses-lite-model.ts";
import { applyResponsesLiteWebSocketMetadata } from "./responses-lite.ts";
import { combineAbortSignals, compressRequestBodyZstd, createSSEHeaderTimeout, normalizeTimeoutMs, parseSSE, sleep } from "./sse.ts";
import { assertSuccessfulCodexOutput, CodexProtocolError, codexOverloadRetryDelay, codexRateLimitRetryDelay, codexStreamRetryDelay, createCodexHttpError, isCodexApiError, isCodexOverloadError, isCodexRateLimitError, isRetryableCodexStreamError, processCodexResponsesStream } from "./stream-events.ts";
import { CODEX_TURN_STATE_HEADER, type CodexTurnState, withCodexTurnState, withCodexTurnStateHeader } from "./turn-state.ts";
import type { CanonicalHistoryDecision, CodexDiagnosticsLane, CodexDiagnosticsSink, CodexProviderStreamOptions, OpenAICodexStreamOptions, ResponsesBody } from "./types.ts";
import { createInitialAssistantMessage } from "./types.ts";
import { finalizeUsage } from "./usage.ts";
import { isWebSocketSseFallbackActive, recordWebSocketSseFallback, validateWebSocketTimeoutOptions } from "./websocket.ts";
import { isPermanentWebSocketError, isWebSocketMessageTooBigError, isWebSocketUnauthorizedError, isWebSocketUpgradeRequiredError } from "./websocket-connection.ts";
import { processWebSocketStream } from "./websocket-stream.ts";
import { withRemoteCompactionV2Feature } from "../openai-responses/compaction-v2-feature.ts";
import { captureCanonicalSessionToken, recordCanonicalSessionResponse, validateCanonicalSessionRequest } from "./session-continuity.ts";

export type CodexProviderRuntimeConfig = Pick<CodexConversionConfig, "openai" | "executionMode"> & Partial<Pick<CodexConversionConfig, "compaction">>;

export interface CodexTransportRecoveryDependencies {
	getConfig?: () => CodexProviderRuntimeConfig | undefined;
	useResponsesLite?: (model: Model<Api>) => boolean;
	turnState?: CodexTurnState | undefined;
	onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
	onStreamSettled?: () => void | undefined;
	getDiagnostics?: (() => CodexDiagnosticsSink | undefined) | undefined;
	prepareRequestBody: <TApi extends Api>(
		model: Model<TApi>,
		context: Context,
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

function rateLimitRecoveryBudgetError(error: unknown): NonRetryableProviderError {
	const requestedDelayMs = codexStreamRetryDelay(error);
	const detail = requestedDelayMs === undefined ? "" : ` Provider requested a wait of ${Math.ceil(requestedDelayMs / 1000)} seconds.`;
	return new NonRetryableProviderError(`Codex throttling exceeded the three-minute automatic recovery window.${detail}`);
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
): Promise<Response> {
	let lastError: Error | undefined;
	for (let attempt = 0; attempt <= MAX_SSE_REQUEST_RETRIES; attempt++) {
		if (options?.signal?.aborted) throw new Error("Request was aborted");
		let response: Response;
		try {
			const headerTimeout = createSSEHeaderTimeout(DEFAULT_SSE_HEADER_TIMEOUT_MS);
			const combinedSignal = combineAbortSignals([options?.signal, headerTimeout.signal]);
			try {
				response = await fetch(resolveCodexUrl(model.baseUrl), {
					method: "POST",
					headers: withCodexTurnStateHeader(baseHeaders, turnState),
					body,
					signal: combinedSignal.signal,
				});
			} catch (error) {
				const timeoutError = headerTimeout.error();
				throw timeoutError && !options?.signal?.aborted ? timeoutError : error;
			} finally {
				combinedSignal.cleanup();
				headerTimeout.clear();
			}
		} catch (error) {
			if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
				throw new Error("Request was aborted");
			}
			lastError = error instanceof Error ? error : new Error(String(error));
			if (attempt < MAX_SSE_REQUEST_RETRIES) {
				await sleep(codexStreamRetryDelayMs(attempt + 1), options?.signal);
				continue;
			}
			throw lastError;
		}

		if (response.ok) turnState?.capture(response.headers.get(CODEX_TURN_STATE_HEADER));
		await options?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);
		if (response.ok) return response;

		const errorText = await response.text();
		const info = await parseErrorResponse(new Response(errorText, { status: response.status, statusText: response.statusText }));
		const message = info.friendlyMessage || info.message;
		if (info.code === "server_is_overloaded" || info.code === "slow_down") {
			throw createCodexHttpError(message, info.code, response.status);
		}
		const requestRetryable = isRetryableRequestStatus(response.status);
		if (requestRetryable && attempt < MAX_SSE_REQUEST_RETRIES) {
			await sleep(codexStreamRetryDelayMs(attempt + 1), options?.signal);
			continue;
		}
		if (info.code) throw createCodexHttpError(message, info.code, response.status);
		throw isRetryableStreamStatus(response.status) ? new Error(message) : new NonRetryableProviderError(message);
	}
	throw lastError ?? new Error("Failed after retries");
}

export function createCodexTransportStream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: CodexProviderStreamOptions | undefined,
	deps: CodexTransportRecoveryDependencies,
): AssistantMessageEventStream {
	const runtimeConfig = deps.getConfig?.();
	const responsesLite = deps.useResponsesLite?.(model)
		?? ((runtimeConfig?.executionMode === "code" || runtimeConfig?.executionMode === "notebook")
			&& supportsResponsesLiteModel(model.id));
	const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, responsesLite);
	const preferredTransport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai);
	const effectiveTransport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai, options?.sessionId);
	const effectiveOptions: OpenAICodexStreamOptions | undefined = options
		? {
			...options,
			transport: effectiveTransport,
			grammarToolInputProperties,
			...(runtimeConfig?.compaction?.responsesCompaction ? { headers: withRemoteCompactionV2Feature(options.headers) } : {}),
		}
		: { transport: effectiveTransport, grammarToolInputProperties };
	const stream = createAssistantMessageEventStream();

	(async () => {
		let output = createInitialAssistantMessage(model);
		const diagnostics = noThrowCodexDiagnosticsSink(deps.getDiagnostics?.());
		let lane: Exclude<CodexDiagnosticsLane, "prewarm"> = "response";
		let diagnosticsFailureRecorded = false;
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
			const reconstructedBody = await deps.prepareRequestBody(model, context, effectiveOptions, responsesLite);
			const body = reconstructedBody;
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
			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const routing = resolveCodexRequestRouting({
				model: body.model,
				fast: runtimeConfig?.openai.fast === true,
				serviceTier: body.service_tier,
				normalOriginator: runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : "pi",
			});
			const baseSseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId, responsesLite, routing.originator, routing.routingHint);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId, routing.originator, routing.routingHint);
			const bodyJson = JSON.stringify(body);
			const websocketBody = responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body;
			const compressedBody = compressRequestBodyZstd(bodyJson);
			if (compressedBody) baseSseHeaders.set("content-encoding", "zstd");
			const sseBody = compressedBody ?? bodyJson;
			const transport = effectiveOptions.transport ?? "auto";
			const streamMaxRetries = codexStreamMaxRetries(effectiveOptions);
			let overloadRetryCount = 0;
			let overloadWaitedMs = 0;
			let rateLimitWaitedMs = 0;
			const planRetry = (error: unknown, retryCount: number) => {
				const overload = isCodexOverloadError(error);
				const rateLimit = isCodexRateLimitError(error);
				const fallbackDelayMs = codexStreamRetryDelayMs(retryCount);
				return {
					overload,
					rateLimit,
					delayMs: overload
						? codexOverloadRetryDelay(error, overloadRetryCount, overloadWaitedMs)
						: rateLimit
							? codexRateLimitRetryDelay(error, fallbackDelayMs, rateLimitWaitedMs)
							: codexStreamRetryDelay(error) ?? fallbackDelayMs,
				};
			};
			const waitBeforeRetry = async (plan: { overload: boolean; rateLimit: boolean; delayMs: number | undefined }) => {
				if (plan.delayMs === undefined) return false;
				await sleep(plan.delayMs, effectiveOptions?.signal);
				if (plan.overload) {
					overloadRetryCount++;
					overloadWaitedMs += plan.delayMs;
				}
				if (plan.rateLimit) rateLimitWaitedMs += plan.delayMs;
				return true;
			};

			let streamStarted = false;
			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
					// Event partials are authoritative snapshots; a fresh partial makes the
					// next content-start replace failed-attempt output without a second message start.
					if (attempt > 0) output = createInitialAssistantMessage(model);
					let websocketStarted = false;
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
							effectiveOptions,
							deps.turnState,
							diagnostics ? { lane, attempt: attempt + 1, record: diagnostics } : undefined,
							{
								reconstructedRequestBody: reconstructedBody,
								token: canonicalSessionToken,
								decision: canonicalHistory,
							},
						);
						if (effectiveOptions?.signal?.aborted) throw new Error("Request was aborted");
						finalizeUsage(output);
						assertSuccessfulCodexOutput(output);
						recordUsage(diagnostics, lane, "websocket", output);
						stream.push({ type: "done", reason: output.stopReason, message: output });
						stream.end();
						return;
					} catch (error) {
						if (effectiveOptions?.signal?.aborted) throw error;
						const upgradeRequired = isWebSocketUpgradeRequiredError(error);
						const messageTooBig = isWebSocketMessageTooBigError(error);
						const unauthorized = isWebSocketUnauthorizedError(error);
						const retryableWebSocketError = (isCodexApiError(error) || !isPermanentWebSocketError(error)) && isRetryableCodexStreamError(error);
						const retryPlan = planRetry(error, attempt + 1);
						const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
						const rateLimitBudgetExhausted = retryPlan.rateLimit && retryPlan.delayMs === undefined;
						const immediateFallback = upgradeRequired || messageTooBig || unauthorized;
						const fallbackArmed = immediateFallback || (retryableWebSocketError && (attempt >= streamMaxRetries || overloadBudgetExhausted));
						appendAssistantMessageDiagnostic(
							output,
							createAssistantMessageDiagnostic(retryableWebSocketError ? "provider_transport_failure" : "provider_stream_failure", error, {
								configuredTransport: preferredTransport,
								fallbackTransport: fallbackArmed ? "sse" : undefined,
								eventsEmitted: websocketStarted,
								phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
								requestBytes: new TextEncoder().encode(bodyJson).byteLength,
							}),
						);
						if (!immediateFallback && retryableWebSocketError && attempt < streamMaxRetries && !overloadBudgetExhausted && !rateLimitBudgetExhausted) {
							diagnostics?.({
								type: "retry",
								lane,
								transport: "websocket",
								attempt: attempt + 2,
								...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
								failure: codexDiagnosticsFailure(error),
							});
							await waitBeforeRetry(retryPlan);
							continue;
						}
						if (rateLimitBudgetExhausted) {
							throw rateLimitRecoveryBudgetError(error);
						}
						if (!fallbackArmed) {
							recordFailure("websocket", error);
							if (websocketStarted && !(error instanceof CodexProtocolError) && !isCodexApiError(error)) {
								throw new NonRetryableProviderError("Codex stream ended after output began and cannot be continued from its incomplete response.");
							}
							throw error;
						}
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
					}
				}
			}

			const sseIdleTimeoutMs = normalizeTimeoutMs(effectiveOptions?.timeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS, "timeoutMs");
			for (let attempt = 0; attempt <= streamMaxRetries; attempt++) {
				if (attempt > 0) output = createInitialAssistantMessage(model);
				const responseItems: unknown[] = [];
				try {
					if (effectiveOptions?.compactionDiagnostics) {
						Object.assign(effectiveOptions.compactionDiagnostics, {
							transport: "sse",
							continuation: undefined,
							previousResponseId: false,
							fullInputItems: body.input.length,
							sentInputItems: body.input.length,
						});
					}
					diagnostics?.({
						type: "request",
						lane,
						transport: "sse",
						attempt: attempt + 1,
						fullInputItems: body.input.length,
						sentInputItems: body.input.length,
						model: body.model,
						...(canonicalHistory ? { canonicalHistory } : {}),
						...(effectiveOptions?.compactionDiagnostics ? { compaction: structuredClone(effectiveOptions.compactionDiagnostics) } : {}),
					});
					const response = await openCodexSSE(model, sseBody, baseSseHeaders, effectiveOptions, deps.turnState);
					if (!response.body) throw new Error("No response body");
					if (!streamStarted) {
						streamStarted = true;
						stream.push({ type: "start", partial: output });
					}
					await processCodexResponsesStream(
						parseSSE(response, effectiveOptions?.signal, sseIdleTimeoutMs),
						output,
						stream,
						model,
						{ ...effectiveOptions, onOutputItemDone: (item) => responseItems.push(item) },
					);
					finalizeUsage(output);
					if (effectiveOptions?.signal?.aborted) throw new Error("Request was aborted");
					assertSuccessfulCodexOutput(output);
					recordUsage(diagnostics, lane, "sse", output);
					for (const item of responseItems) effectiveOptions?.onOutputItemDone?.(item);
					recordCanonicalSessionResponse({
						sessionId: effectiveOptions?.sessionId,
						url: resolveCodexWebSocketUrl(model.baseUrl),
						accountId,
						requestBody: body,
						reconstructedRequestBody: reconstructedBody,
						responseItems,
						token: canonicalSessionToken,
					});
					stream.push({ type: "done", reason: output.stopReason, message: output });
					stream.end();
					return;
				} catch (error) {
					if (effectiveOptions?.signal?.aborted) throw error;
					const retryable = !(error instanceof NonRetryableProviderError) && isRetryableCodexStreamError(error);
					const retryPlan = planRetry(error, attempt + 1);
					const overloadBudgetExhausted = retryPlan.overload && retryPlan.delayMs === undefined;
					const rateLimitBudgetExhausted = retryPlan.rateLimit && retryPlan.delayMs === undefined;
					appendAssistantMessageDiagnostic(
						output,
						createAssistantMessageDiagnostic(retryable ? "provider_transport_failure" : "provider_stream_failure", error, {
							configuredTransport: preferredTransport,
							eventsEmitted: output.content.length > 0,
							phase: output.content.length > 0 ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(bodyJson).byteLength,
						}),
					);
					if (retryable && attempt < streamMaxRetries && !overloadBudgetExhausted && !rateLimitBudgetExhausted) {
						diagnostics?.({
							type: "retry",
							lane,
							transport: "sse",
							attempt: attempt + 2,
							...(retryPlan.delayMs !== undefined ? { delayMs: retryPlan.delayMs } : {}),
							failure: codexDiagnosticsFailure(error),
						});
						await waitBeforeRetry(retryPlan);
						continue;
					}
					if (rateLimitBudgetExhausted) {
						throw rateLimitRecoveryBudgetError(error);
					}
					recordFailure("sse", error);
					if (retryable) throw new NonRetryableProviderError("Codex stream retry budget was exhausted before a response completed.");
					throw error;
				}
			}
		} catch (error) {
			if (!diagnosticsFailureRecorded) recordFailure(effectiveTransport === "sse" ? "sse" : "websocket", error);
			stream.push({
				type: "error",
				reason: (effectiveOptions?.signal?.aborted ? "aborted" : "error") as "aborted" | "error",
				error: createErrorMessage(output, error, !!effectiveOptions?.signal?.aborted),
			});
			stream.end();
		} finally {
			deps.onStreamSettled?.();
		}
	})();

	return stream;
}
