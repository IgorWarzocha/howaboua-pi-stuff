import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Image, Spacer, Text } from "@earendil-works/pi-tui";
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
import type { CodexConversionConfig } from "../adapter/config.ts";
import { rewriteNativeImageGenerationTool } from "../tools/image-generation-tool.ts";
import { rewriteNativeWebSearchTool } from "../tools/web-search-tool.ts";
import { BASE_DELAY_MS, DEFAULT_SSE_HEADER_TIMEOUT_MS, MAX_RETRIES, IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, WEB_SEARCH_ACTIVITY_MESSAGE_TYPE } from "./openai-codex/constants.ts";
import { createErrorMessage, isRetryableError, NonRetryableProviderError, parseErrorResponse } from "./openai-codex/errors.ts";
import { buildGeneratedImageDisplayText } from "./openai-codex/image-output.ts";
import { createCodexRequestId, extractAccountId, buildSSEHeaders, buildWebSocketHeaders, headersToRecord, resolveCodexUrl, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { combineAbortSignals, createSSEHeaderTimeout, parseSSE, sleep } from "./openai-codex/sse.ts";
import type { CodexProviderStreamOptions, OpenAICodexStreamOptions, PendingActivity, ResponsesBody, SavedGeneratedImage, SurfacedWebSearch, ImageDisplayMessageDetails } from "./openai-codex/types.ts";
import { createInitialAssistantMessage } from "./openai-codex/types.ts";
import { finalizeUsage } from "./openai-codex/usage.ts";
import { buildWebSearchSummaryText, createActivityMessageDispatcher, loadCachedImagePreview } from "./openai-codex/activity.ts";
import { closeOpenAICodexWebSocketSessions, validateWebSocketTimeoutOptions } from "./openai-codex/websocket.ts";
import { getLatestUserText, processCapturedResponsesStream } from "./openai-codex/stream-events.ts";
import { processWebSocketStream } from "./openai-codex/websocket-stream.ts";

export { IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, WEB_SEARCH_ACTIVITY_MESSAGE_TYPE } from "./openai-codex/constants.ts";
export { buildProviderErrorMessage } from "./openai-codex/errors.ts";
export { buildGeneratedImageDisplayText, getOpenAICodexImageDirectory, getOpenAICodexImagePath, getOpenAICodexLatestImagePath, saveOpenAICodexGeneratedImage } from "./openai-codex/image-output.ts";
export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody, requestBodyForWebSocketContinuationComparison } from "./openai-codex/websocket-continuation.ts";
export { buildWebSearchActivityMessage, buildWebSearchSummaryText, createActivityMessageDispatcher } from "./openai-codex/activity.ts";
export { closeOpenAICodexWebSocketSessions } from "./openai-codex/websocket.ts";
export type { CachedWebSocketContinuationState, CachedWebSocketRequestBodyResult, ResponsesBody, WebSocketContinuationDecision } from "./openai-codex/types.ts";

export function getEffectiveCodexTransport(
	transport: Transport | undefined,
	config: Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined,
): Transport {
	const configuredTransport = transport ?? "auto";
	if (config?.forceCachedWebSockets === false) return configuredTransport;
	if (configuredTransport === "websocket") return "websocket-cached";
	return configuredTransport;
}

function createCodexStream<TApi extends Api>(
	model: Model<TApi>,
	context: Context,
	options: CodexProviderStreamOptions | undefined,
	deps: {
		getCurrentCwd: () => string;
		getConfig?: () => Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined;
		getNativeToolRewriteConfig?: () => { webSearch: boolean; imageGeneration: boolean } | undefined;
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
		onStreamSettled?: () => void | undefined;
	},
): AssistantMessageEventStream {
	const effectiveTransport = getEffectiveCodexTransport(options?.transport, deps.getConfig?.());
	const effectiveOptions: OpenAICodexStreamOptions | undefined = options
		? { ...options, transport: effectiveTransport }
		: { transport: effectiveTransport };
	const stream = createAssistantMessageEventStream();
	const requestCwd = deps.getCurrentCwd();

	(async () => {
		const output = createInitialAssistantMessage(model);
		const requestPrompt = getLatestUserText(context);

		try {
			const apiKey = effectiveOptions?.apiKey;
			if (!apiKey) {
				throw new Error(`No API key for provider: ${model.provider}`);
			}

			const accountId = extractAccountId(apiKey);
			let body = buildRequestBody(model, context, effectiveOptions);
			const nextBody = await effectiveOptions?.onPayload?.(body, model);
			if (nextBody !== undefined) {
				body = nextBody as ResponsesBody;
			}
			const nativeToolRewriteConfig = deps.getNativeToolRewriteConfig?.();
			if (nativeToolRewriteConfig?.webSearch) {
				body = rewriteNativeWebSearchTool(body, model) as ResponsesBody;
			}
			if (nativeToolRewriteConfig?.imageGeneration) {
				body = rewriteNativeImageGenerationTool(body, model) as ResponsesBody;
			}

			const websocketRequestId = effectiveOptions?.sessionId || createCodexRequestId();
			const sseHeaders = buildSSEHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, effectiveOptions?.sessionId);
			const websocketHeaders = buildWebSocketHeaders(model.headers, effectiveOptions?.headers, accountId, apiKey, websocketRequestId);
			const bodyJson = JSON.stringify(body);
			const transport = effectiveOptions.transport ?? "auto";

			if (transport !== "sse") {
				validateWebSocketTimeoutOptions(effectiveOptions);
				let websocketStarted = false;
				try {
					await processWebSocketStream(
						resolveCodexWebSocketUrl(model.baseUrl),
						body,
						websocketHeaders,
						output,
						stream,
						model,
						() => {
							websocketStarted = true;
						},
						effectiveOptions,
						deps,
						requestCwd,
						requestPrompt,
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
							body: bodyJson,
							signal: combinedSignal.signal,
						});
					} catch (error) {
						const timeoutError = headerTimeout.error();
						throw timeoutError && !effectiveOptions?.signal?.aborted ? new NonRetryableProviderError(timeoutError.message) : error;
					} finally {
						combinedSignal.cleanup();
						headerTimeout.clear();
					}

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
			await processCapturedResponsesStream(parseSSE(response, effectiveOptions?.signal), output, stream, model, effectiveOptions, deps, requestCwd, requestPrompt);
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

export function registerOpenAICodexCustomProvider(pi: ExtensionAPI, options: { getCurrentCwd: () => string; getConfig?: () => Pick<CodexConversionConfig, "forceCachedWebSockets"> | undefined; getNativeToolRewriteConfig?: () => { webSearch: boolean; imageGeneration: boolean } | undefined }): void {
	const activityDispatcher = createActivityMessageDispatcher(pi.sendMessage.bind(pi));

	const clearPendingMessages = () => {
		activityDispatcher.clear();
	};

	pi.registerProvider("openai-codex", {
		api: "openai-codex-responses",
		streamSimple: (model, context, streamOptions) => {
			const turnActivities: PendingActivity[] = [];
			return createCodexStream(model, context, streamOptions, {
				getCurrentCwd: options.getCurrentCwd,
				...(options.getConfig ? { getConfig: options.getConfig } : {}),
				...(options.getNativeToolRewriteConfig ? { getNativeToolRewriteConfig: options.getNativeToolRewriteConfig } : {}),
				onImageSaved: (savedImage, imageData) => {
					turnActivities.push({ kind: "image", savedImage, imageData });
				},
				onWebSearchCaptured: (search) => {
					turnActivities.push({ kind: "web-search", search });
				},
				onStreamSettled: () => {
					const activities = turnActivities.splice(0, turnActivities.length);
					if (activities.length > 0) activityDispatcher.enqueueSettledActivities(activities);
				},
			});
		},
	});

	pi.on("session_start", async () => {
		clearPendingMessages();
	});

	pi.on("session_shutdown", async () => {
		activityDispatcher.flushNow();
		clearPendingMessages();
		closeOpenAICodexWebSocketSessions();
	});

	pi.on("agent_end", async () => {
		activityDispatcher.scheduleFlush();
	});

	pi.registerMessageRenderer<ImageDisplayMessageDetails>(IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, (message, options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold("[image_generation]")), 0, 0));
		const savedImage = message.details?.savedImages?.[0];
		const textContent = savedImage
			? buildGeneratedImageDisplayText(savedImage, { expanded: options.expanded })
			: typeof message.content === "string"
				? message.content
				: message.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n");
		box.addChild(new Text(`\n${theme.fg("customMessageText", textContent)}`, 0, 0));
		if (savedImage) {
			const preview = loadCachedImagePreview(savedImage, activityDispatcher.imagePreviewCache);
			if (preview) {
				box.addChild(new Spacer(1));
				box.addChild(
					new Image(preview.data, preview.mimeType, { fallbackColor: (text) => theme.fg("customMessageText", text) }, { maxWidthCells: 60 }),
				);
			}
		}
		return box;
	});

	pi.registerMessageRenderer<{ searches?: SurfacedWebSearch[] | undefined }>(WEB_SEARCH_ACTIVITY_MESSAGE_TYPE, (message, options, theme) => {
		const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
		const searches = message.details?.searches ?? [];
		box.addChild(new Text(theme.fg("customMessageLabel", theme.bold(buildWebSearchSummaryText(searches))), 0, 0));
		if (options.expanded) {
			const content = typeof message.content === "string"
				? message.content
				: message.content
						.filter((item) => item.type === "text")
						.map((item) => item.text)
						.join("\n");
			box.addChild(new Text(`\n${theme.fg("customMessageText", content)}`, 0, 0));
		}
		return box;
	});
}
