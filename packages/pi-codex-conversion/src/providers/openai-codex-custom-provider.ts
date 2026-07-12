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
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { applyCodeModeFreeformContract } from "../adapter/code-mode-contract.ts";
import { BASE_DELAY_MS, DEFAULT_SSE_HEADER_TIMEOUT_MS, MAX_RETRIES } from "./openai-codex/constants.ts";
import { createErrorMessage, isRetryableError, NonRetryableProviderError, parseErrorResponse } from "./openai-codex/errors.ts";
import { createCodexRequestId, extractAccountId, buildSSEHeaders, buildWebSocketHeaders, headersToRecord, resolveCodexUrl, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, isResponsesLiteRequest, prepareResponsesLiteRequestImages, supportsResponsesLiteModel } from "./openai-codex/responses-lite.ts";
import { combineAbortSignals, compressRequestBodyZstd, createSSEHeaderTimeout, parseSSE, sleep } from "./openai-codex/sse.ts";
import type { CodexProviderStreamOptions, OpenAICodexStreamOptions, ResponsesBody } from "./openai-codex/types.ts";
import { createInitialAssistantMessage } from "./openai-codex/types.ts";
import { finalizeUsage } from "./openai-codex/usage.ts";
import { closeOpenAICodexWebSocketSessions, validateWebSocketTimeoutOptions } from "./openai-codex/websocket.ts";
import { processCodexResponsesStream } from "./openai-codex/stream-events.ts";
import { prewarmWebSocket, processWebSocketStream } from "./openai-codex/websocket-stream.ts";
import { openaiCodexNativeOAuthProvider } from "./openai-codex/oauth.ts";
import { CODEX_TURN_STATE_HEADER, type CodexTurnState } from "./openai-codex/turn-state.ts";

export { buildProviderErrorMessage } from "./openai-codex/errors.ts";
export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody, requestBodyForWebSocketContinuationComparison } from "./openai-codex/websocket-continuation.ts";
export { closeOpenAICodexWebSocketSessions } from "./openai-codex/websocket.ts";
export type { CachedWebSocketContinuationState, CachedWebSocketRequestBodyResult, ResponsesBody, WebSocketContinuationDecision } from "./openai-codex/types.ts";

export function getEffectiveCodexTransport(
	transport: Transport | undefined,
	config: Pick<CodexConversionConfig["openai"], "forceCachedWebSockets"> | undefined,
): Transport {
	const configuredTransport = transport ?? "auto";
	if (config?.forceCachedWebSockets === false) return configuredTransport;
	if (configuredTransport === "websocket") return "websocket-cached";
	return configuredTransport;
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
		body = applyCodeModeFreeformContract(body);
		body = isResponsesLiteRequest(body)
			? { ...body, parallel_tool_calls: false }
			: applyResponsesLiteRequest(body);
		body = await prepareResponsesLiteRequestImages(body);
	}
	return body;
}

export async function prewarmOpenAICodexWebSocket<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: OpenAICodexStreamOptions,
	deps: {
		getConfig?: () => Pick<CodexConversionConfig, "openai" | "beta"> | undefined;
		turnState?: CodexTurnState | undefined;
	},
): Promise<void> {
	const runtimeConfig = deps.getConfig?.();
	if (getEffectiveCodexTransport(options.transport, runtimeConfig?.openai) === "sse") return;
	if (!options.apiKey || !options.sessionId) return;
	const responsesLite = runtimeConfig?.beta.codeMode === true && supportsResponsesLiteModel(model.id);
	const body = await prepareCodexRequestBody(model, context, options, responsesLite);
	const accountId = extractAccountId(options.apiKey);
	const headers = buildWebSocketHeaders(model.headers, options.headers, accountId, options.apiKey, options.sessionId);
	let websocketBody = responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body;
	const currentTurnState = deps.turnState?.current();
	if (currentTurnState) {
		websocketBody = {
			...websocketBody,
			client_metadata: { ...(websocketBody.client_metadata ?? {}), [CODEX_TURN_STATE_HEADER]: currentTurnState },
		};
	}
	await prewarmWebSocket(resolveCodexWebSocketUrl(model.baseUrl), websocketBody, headers, options, deps.turnState);
}

function createCodexStream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: CodexProviderStreamOptions | undefined,
	deps: {
		getConfig?: () => Pick<CodexConversionConfig, "openai" | "beta"> | undefined;
		turnState?: CodexTurnState | undefined;
		onStreamSettled?: () => void | undefined;
	},
): AssistantMessageEventStream {
	const runtimeConfig = deps.getConfig?.();
	const effectiveTransport = getEffectiveCodexTransport(options?.transport, runtimeConfig?.openai);
	const effectiveOptions: OpenAICodexStreamOptions | undefined = options
		? { ...options, transport: effectiveTransport }
		: { transport: effectiveTransport };
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output = createInitialAssistantMessage(model);
		try {
			const responsesLite = runtimeConfig?.beta.codeMode === true && supportsResponsesLiteModel(model.id);
			const apiKey = effectiveOptions?.apiKey;
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			const body = await prepareCodexRequestBody(model, context, effectiveOptions, responsesLite);
			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const sseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId, responsesLite);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId);
			const currentTurnState = deps.turnState?.current();
			if (currentTurnState) sseHeaders.set(CODEX_TURN_STATE_HEADER, currentTurnState);
			const bodyJson = JSON.stringify(body);
			let websocketBody = responsesLite ? applyResponsesLiteWebSocketMetadata(body) : body;
			if (currentTurnState) {
				websocketBody = {
					...websocketBody,
					client_metadata: { ...(websocketBody.client_metadata ?? {}), [CODEX_TURN_STATE_HEADER]: currentTurnState },
				};
			}
			const compressedBody = compressRequestBodyZstd(bodyJson);
			if (compressedBody) sseHeaders.set("content-encoding", "zstd");
			const sseBody = compressedBody ?? bodyJson;
			const transport = effectiveOptions.transport ?? "auto";

			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				let websocketStarted = false;
				try {
					await processWebSocketStream(
						resolveCodexWebSocketUrl(model.baseUrl),
						websocketBody,
						websocketHeaders,
						output,
						stream,
						model,
						() => {
							websocketStarted = true;
						},
						effectiveOptions,
						deps.turnState,
					);
					if (effectiveOptions?.signal?.aborted) {
						throw new Error("Request was aborted");
					}
					finalizeUsage(output);
					stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
					stream.end();
					return;
				} catch (error) {
					appendAssistantMessageDiagnostic(
						output,
						createAssistantMessageDiagnostic("provider_transport_failure", error, {
							configuredTransport: transport,
							fallbackTransport: websocketStarted ? undefined : "sse",
							eventsEmitted: websocketStarted,
							phase: websocketStarted ? "after_message_stream_start" : "before_message_stream_start",
							requestBytes: new TextEncoder().encode(bodyJson).byteLength,
						}),
					);
					if (transport === "websocket" || transport === "websocket-cached" || websocketStarted) {
						throw error;
					}
				}
			}

			let response: Response | undefined;
			let lastError: Error | undefined;

			for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
				if (effectiveOptions?.signal?.aborted) {
					throw new Error("Request was aborted");
				}

				try {
					const headerTimeout = createSSEHeaderTimeout(DEFAULT_SSE_HEADER_TIMEOUT_MS);
					const combinedSignal = combineAbortSignals([effectiveOptions?.signal, headerTimeout.signal]);
					try {
						response = await fetch(resolveCodexUrl(model.baseUrl), {
							method: "POST",
							headers: sseHeaders,
							body: sseBody,
							signal: combinedSignal.signal,
						});
					} catch (error) {
						const timeoutError = headerTimeout.error();
						throw timeoutError && !effectiveOptions?.signal?.aborted ? new NonRetryableProviderError(timeoutError.message) : error;
					} finally {
						combinedSignal.cleanup();
						headerTimeout.clear();
					}

					if (response.ok) deps.turnState?.capture(response.headers.get(CODEX_TURN_STATE_HEADER));
					await effectiveOptions?.onResponse?.({ status: response.status, headers: headersToRecord(response.headers) }, model);

					if (response.ok) {
						break;
					}

					const errorText = await response.text();
					if (attempt < MAX_RETRIES && isRetryableError(response.status, errorText)) {
						await sleep(BASE_DELAY_MS * 2 ** attempt, effectiveOptions?.signal);
						continue;
					}

					const fakeResponse = new Response(errorText, {
						status: response.status,
						statusText: response.statusText,
					});
					const info = await parseErrorResponse(fakeResponse);
					throw new NonRetryableProviderError(info.friendlyMessage || info.message);
				} catch (error) {
					if (error instanceof NonRetryableProviderError) {
						throw error;
					}
					if (error instanceof Error && (error.name === "AbortError" || error.message === "Request was aborted")) {
						throw new Error("Request was aborted");
					}

					lastError = error instanceof Error ? error : new Error(String(error));
					if (attempt < MAX_RETRIES && !lastError.message.includes("usage limit")) {
						await sleep(BASE_DELAY_MS * 2 ** attempt, effectiveOptions?.signal);
						continue;
					}
					throw lastError;
				}
			}

			if (!response?.ok) {
				throw lastError ?? new Error("Failed after retries");
			}

			if (!response.body) {
				throw new Error("No response body");
			}

			stream.push({ type: "start", partial: output });
			await processCodexResponsesStream(parseSSE(response, effectiveOptions?.signal), output, stream, model, effectiveOptions);
			finalizeUsage(output);

			if (effectiveOptions?.signal?.aborted) {
				throw new Error("Request was aborted");
			}

			stream.push({ type: "done", reason: output.stopReason as "stop" | "length" | "toolUse", message: output });
			stream.end();
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

export function registerOpenAICodexCustomProvider(pi: ExtensionAPI, options: { getConfig?: () => Pick<CodexConversionConfig, "openai" | "beta"> | undefined; turnState?: CodexTurnState | undefined }): void {
	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		oauth: openaiCodexNativeOAuthProvider,
		streamSimple: (model, context, streamOptions) => createCodexStream(model, context, streamOptions, {
			...(options.getConfig ? { getConfig: options.getConfig } : {}),
			...(options.turnState ? { turnState: options.turnState } : {}),
		}),
	});

	pi.on("session_shutdown", async () => {
		closeOpenAICodexWebSocketSessions();
	});
}
