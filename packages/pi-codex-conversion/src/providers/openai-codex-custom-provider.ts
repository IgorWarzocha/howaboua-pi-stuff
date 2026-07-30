import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	createAssistantMessageEventStream,
	appendAssistantMessageDiagnostic,
	createAssistantMessageDiagnostic,
	type Api,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type Transport,
} from "@earendil-works/pi-ai";
import { createGrammarToolInputProperties } from "./constrained-sampling.js";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { DEFAULT_MAX_RETRY_DELAY_MS, DEFAULT_SSE_HEADER_TIMEOUT_MS, DEFAULT_STREAM_IDLE_TIMEOUT_MS, DEFAULT_STREAM_MAX_RETRIES, INITIAL_STREAM_RETRY_DELAY_MS, MAX_SSE_REQUEST_RETRIES, MAX_STREAM_MAX_RETRIES } from "./openai-codex/constants.ts";
import { createErrorMessage, isRetryableRequestStatus, isRetryableStreamStatus, NonRetryableProviderError, parseErrorResponse } from "./openai-codex/errors.ts";
import { createCodexRequestId, extractAccountId, buildSSEHeaders, buildWebSocketHeaders, headersToRecord, PI_CODEX_CONVERSION_ORIGINATOR, resolveCodexUrl, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { supportsResponsesLiteModel } from "./openai-codex/responses-lite-model.ts";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, prepareResponsesLiteRequestImages } from "./openai-codex/responses-lite.ts";
import { combineAbortSignals, compressRequestBodyZstd, createSSEHeaderTimeout, normalizeTimeoutMs, parseSSE, sleep } from "./openai-codex/sse.ts";
import type { CodexProviderStreamOptions, OpenAICodexStreamOptions, ResponsesBody } from "./openai-codex/types.ts";
import { createInitialAssistantMessage } from "./openai-codex/types.ts";
import { finalizeUsage } from "./openai-codex/usage.ts";
import {
	isWebSocketSseFallbackActive,
	recordWebSocketSseFallback,
	validateWebSocketTimeoutOptions,
} from "./openai-codex/websocket.ts";
import { isPermanentWebSocketError, isWebSocketMessageTooBigError, isWebSocketUnauthorizedError, isWebSocketUpgradeRequiredError } from "./openai-codex/websocket-connection.ts";
import { assertSuccessfulCodexOutput, codexOverloadRetryDelay, codexRateLimitRetryDelay, codexStreamRetryDelay, createCodexHttpError, isCodexApiError, isCodexOverloadError, isCodexRateLimitError, isRetryableCodexStreamError, processCodexResponsesStream } from "./openai-codex/stream-events.ts";
import { prewarmWebSocket, processWebSocketStream } from "./openai-codex/websocket-stream.ts";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.ts";
import { CODEX_TURN_STATE_HEADER, type CodexTurnState } from "./openai-codex/turn-state.ts";
import { withRemoteCompactionV2Feature } from "./openai-responses/compaction-v2-feature.ts";
import { normalizeResponsesToolHistory } from "./openai-responses/tool-history.ts";

type CodexProviderRuntimeConfig = Pick<CodexConversionConfig, "openai" | "beta"> & Partial<Pick<CodexConversionConfig, "compaction">>;

export { buildProviderErrorMessage } from "./openai-codex/errors.ts";
export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody, requestBodyForWebSocketContinuationComparison } from "./openai-codex/websocket-continuation.ts";
export { closeOpenAICodexWebSocketSessions } from "./openai-codex/websocket.ts";
export type { CachedWebSocketContinuationState, CachedWebSocketRequestBodyResult, ResponsesBody, WebSocketContinuationDecision } from "./openai-codex/types.ts";

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

function withCodexTurnState(body: ResponsesBody, turnState: CodexTurnState | undefined): ResponsesBody {
	const current = turnState?.current();
	return current
		? { ...body, client_metadata: { ...(body.client_metadata ?? {}), [CODEX_TURN_STATE_HEADER]: current } }
		: body;
}

function withCodexTurnStateHeader(headers: Headers, turnState: CodexTurnState | undefined): Headers {
	const attemptHeaders = new Headers(headers);
	const current = turnState?.current();
	if (current) attemptHeaders.set(CODEX_TURN_STATE_HEADER, current);
	return attemptHeaders;
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

async function prepareCodexRequestBody<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: OpenAICodexStreamOptions | undefined,
	responsesLite: boolean,
): Promise<ResponsesBody> {
	let body = buildRequestBody(model, context, options);
	const nextBody = await options?.onPayload?.(body, model);
	if (nextBody !== undefined) body = nextBody as ResponsesBody;
	if (responsesLite) {
		body = isResponsesLiteRequest(body)
			? { ...body, parallel_tool_calls: false }
			: applyResponsesLiteRequest(body);
		body = await prepareResponsesLiteRequestImages(body);
	}
	if (!body.previous_response_id) {
		const input = normalizeResponsesToolHistory(body.input ?? []);
		if (input !== body.input) body = { ...body, input };
	}
	return body;
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

export async function prewarmOpenAICodexWebSocket<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: OpenAICodexStreamOptions,
	deps: {
		getConfig?: () => CodexProviderRuntimeConfig | undefined;
		useResponsesLite?: (model: Model<Api>) => boolean;
		turnState?: CodexTurnState | undefined;
	},
): Promise<void> {
	const runtimeConfig = deps.getConfig?.();
	if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai, options.sessionId) === "sse") return;
	if (!options.apiKey || !options.sessionId) return;
	const responsesLite = deps.useResponsesLite?.(model) ?? (runtimeConfig?.beta.codeMode === true && supportsResponsesLiteModel(model.id));
	const grammarToolInputProperties = createGrammarToolInputProperties(context.tools, responsesLite);
	const effectiveOptions = runtimeConfig?.compaction?.responsesCompaction
		? { ...options, grammarToolInputProperties, headers: withRemoteCompactionV2Feature(options.headers) }
		: { ...options, grammarToolInputProperties };
	const body = await prepareCodexRequestBody(model, context, effectiveOptions, responsesLite);
	const accountId = extractAccountId(options.apiKey);
	const originator = runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : undefined;
	const headers = buildWebSocketHeaders(model.headers, effectiveOptions.headers, accountId, options.apiKey, options.sessionId, originator);
	const websocketBody = withCodexTurnState(responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body, deps.turnState);
	try {
		await prewarmWebSocket(resolveCodexWebSocketUrl(model.baseUrl), websocketBody, headers, effectiveOptions, deps.turnState);
	} catch (error) {
		if (!options.signal?.aborted && (isWebSocketUpgradeRequiredError(error) || isWebSocketMessageTooBigError(error))) {
			recordWebSocketSseFallback(options.sessionId);
			return;
		}
		throw error;
	}
}

function createCodexStream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: CodexProviderStreamOptions | undefined,
	deps: {
		getConfig?: () => CodexProviderRuntimeConfig | undefined;
		useResponsesLite?: (model: Model<Api>) => boolean;
		turnState?: CodexTurnState | undefined;
		onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
		onStreamSettled?: () => void | undefined;
	},
): AssistantMessageEventStream {
	const runtimeConfig = deps.getConfig?.();
	const responsesLite = deps.useResponsesLite?.(model) ?? (runtimeConfig?.beta.codeMode === true && supportsResponsesLiteModel(model.id));
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
		try {
			const apiKey = effectiveOptions?.apiKey;
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			const body = await prepareCodexRequestBody(model, context, effectiveOptions, responsesLite);
			deps.onPreparedPayload?.(body);
			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const originator = runtimeConfig?.openai.harnessIdentifierHeader ? PI_CODEX_CONVERSION_ORIGINATOR : undefined;
			const baseSseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId, responsesLite, originator);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId, originator);
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
							() => {
								websocketStarted = true;
								if (!streamStarted) {
									streamStarted = true;
									stream.push({ type: "start", partial: output });
								}
							},
							effectiveOptions,
							deps.turnState,
						);
						if (effectiveOptions?.signal?.aborted) throw new Error("Request was aborted");
						finalizeUsage(output);
						assertSuccessfulCodexOutput(output);
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
							await waitBeforeRetry(retryPlan);
							continue;
						}
						if (rateLimitBudgetExhausted) {
							throw rateLimitRecoveryBudgetError(error);
						}
						if (!fallbackArmed) {
							if (websocketStarted) {
								throw new NonRetryableProviderError("Codex stream ended after output began and cannot be continued from its incomplete response.");
							}
							throw error;
						}
						// Pi supplies resolved request auth, not a force-refresh handle. Keep 401
						// fallback turn-local so refreshed auth can use WebSockets on the next turn.
						if (!unauthorized) recordWebSocketSseFallback(effectiveOptions?.sessionId);
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
					for (const item of responseItems) effectiveOptions?.onOutputItemDone?.(item);
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
						await waitBeforeRetry(retryPlan);
						continue;
					}
					if (rateLimitBudgetExhausted) {
						throw rateLimitRecoveryBudgetError(error);
					}
					if (retryable) throw new NonRetryableProviderError("Codex stream retry budget was exhausted before a response completed.");
					throw error;
				}
			}
		} catch (error) {
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

export function registerOpenAICodexCustomProvider(pi: ExtensionAPI, options: {
	getConfig?: () => CodexProviderRuntimeConfig | undefined;
	useResponsesLite?: (model: Model<Api>) => boolean;
	turnState?: CodexTurnState | undefined;
	onPreparedPayload?: ((payload: ResponsesBody) => void) | undefined;
}): void {
	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		oauth: openaiCodexNativeOAuthProvider,
		streamSimple: (model, context, streamOptions) => createCodexStream(model, context, streamOptions, {
			...(options.getConfig ? { getConfig: options.getConfig } : {}),
			...(options.useResponsesLite ? { useResponsesLite: options.useResponsesLite } : {}),
			...(options.turnState ? { turnState: options.turnState } : {}),
			...(options.onPreparedPayload ? { onPreparedPayload: options.onPreparedPayload } : {}),
		}),
	});
}
