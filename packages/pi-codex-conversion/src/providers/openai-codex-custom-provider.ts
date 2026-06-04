import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Box, Image, Spacer, Text } from "@earendil-works/pi-tui";
import {
	createAssistantMessageEventStream,
	appendAssistantMessageDiagnostic,
	createAssistantMessageDiagnostic,
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type Model,
	type SimpleStreamOptions,
	type Transport,
} from "@earendil-works/pi-ai";
import { CODEX_TOOL_CALL_PROVIDERS, convertResponsesMessages, processResponsesStream } from "./openai-responses-shared.ts";
import type { CodexConversionConfig } from "../adapter/config.ts";
import { rewriteNativeImageGenerationTool } from "../tools/image-generation-tool.ts";
import { rewriteNativeWebSearchTool } from "../tools/web-search-tool.ts";
import { BASE_DELAY_MS, CODEX_RESPONSE_STATUSES, DEFAULT_SSE_HEADER_TIMEOUT_MS, DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, MAX_RETRIES, SESSION_WEBSOCKET_CACHE_TTL_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE, IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, WEB_SEARCH_ACTIVITY_MESSAGE_TYPE } from "./openai-codex/constants.ts";
import { createErrorMessage, isRetryableError, NonRetryableProviderError, parseErrorResponse } from "./openai-codex/errors.ts";
import { buildGeneratedImageDisplayText, normalizeImageOutputFormat, saveOpenAICodexGeneratedImage } from "./openai-codex/image-output.ts";
import { createCodexRequestId, extractAccountId, buildSSEHeaders, buildWebSocketHeaders, headersToRecord, resolveCodexUrl, resolveCodexWebSocketUrl } from "./openai-codex/headers.ts";
import { buildRequestBody } from "./openai-codex/request-body.ts";
import { combineAbortSignals, createSSEHeaderTimeout, normalizeTimeoutMs, parseSSE, sleep } from "./openai-codex/sse.ts";
import { buildCachedWebSocketRequestBody } from "./openai-codex/websocket-continuation.ts";
import type { AcquiredWebSocket, CachedWebSocketRequestBodyResult, CodexProviderStreamOptions, OpenAICodexStreamOptions, PendingActivity, ResponsesBody, SavedGeneratedImage, ServiceTier, StreamEventShape, SurfacedWebSearch, WebSocketConstructorLike, WebSocketLike, SessionWebSocketCacheEntry, ImageDisplayMessageDetails } from "./openai-codex/types.ts";
import { createInitialAssistantMessage } from "./openai-codex/types.ts";
import { applyServiceTierPricing, finalizeUsage, resolveCodexServiceTier } from "./openai-codex/usage.ts";
import { buildWebSearchSummaryText, createActivityMessageDispatcher, extractWebSearch, loadCachedImagePreview } from "./openai-codex/activity.ts";

export { IMAGE_SAVE_DISPLAY_MESSAGE_TYPE, WEB_SEARCH_ACTIVITY_MESSAGE_TYPE } from "./openai-codex/constants.ts";
export { buildProviderErrorMessage } from "./openai-codex/errors.ts";
export { buildGeneratedImageDisplayText, getOpenAICodexImageDirectory, getOpenAICodexImagePath, getOpenAICodexLatestImagePath, saveOpenAICodexGeneratedImage } from "./openai-codex/image-output.ts";
export { buildRequestBody } from "./openai-codex/request-body.ts";
export { parseSSE } from "./openai-codex/sse.ts";
export { buildCachedWebSocketRequestBody, requestBodyForWebSocketContinuationComparison } from "./openai-codex/websocket-continuation.ts";
export { buildWebSearchActivityMessage, buildWebSearchSummaryText, createActivityMessageDispatcher } from "./openai-codex/activity.ts";
export type { CachedWebSocketRequestBodyResult, ResponsesBody } from "./openai-codex/types.ts";

const dynamicImport = (specifier: string) => import(specifier);
const websocketSessionCache = new Map<string, SessionWebSocketCacheEntry>();

function validateWebSocketTimeoutOptions(options: OpenAICodexStreamOptions | undefined): void {
	normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");
}

let _cachedWebSocket: WebSocketConstructorLike | null = null;
async function getWebSocketConstructor(): Promise<WebSocketConstructorLike | null> {
	if (_cachedWebSocket) return _cachedWebSocket;
	if (
		typeof process !== "undefined" &&
		process.versions["bun"]! &&
		(process.env["HTTP_PROXY"] || process.env["HTTPS_PROXY"]! || process.env["http_proxy"]! || process.env["https_proxy"]!)
	) {
		const module = await dynamicImport("proxy-from-env");
		const getProxyForUrl = (module as { getProxyForUrl: (url: string | object | URL) => string }).getProxyForUrl;
		_cachedWebSocket = class extends WebSocket {
			constructor(url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]) {
				const proxy = getProxyForUrl(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
				const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
				super(url, { ...baseOptions, ...(proxy ? { proxy } : {}) } as never);
			}
		};
		return _cachedWebSocket;
	}
	const ctor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructorLike | undefined }).WebSocket;
	return typeof ctor === "function" ? ctor : null;
}

function getWebSocketReadyState(socket: WebSocketLike): number | undefined {
	return typeof socket.readyState === "number" ? socket.readyState : undefined;
}

function isWebSocketReusable(socket: WebSocketLike): boolean {
	const readyState = getWebSocketReadyState(socket);
	return readyState === undefined || readyState === 1;
}

function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {
		// ignore close errors
	}
}


export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
	const closeEntry = (entry: SessionWebSocketCacheEntry) => {
		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = undefined;
		}
		closeWebSocketSilently(entry.socket, 1000, "session_shutdown");
	};

	if (sessionId) {
		const entry = websocketSessionCache.get(sessionId);
		if (entry) closeEntry(entry);
		websocketSessionCache.delete(sessionId);
		return;
	}

	for (const entry of websocketSessionCache.values()) {
		closeEntry(entry);
	}
	websocketSessionCache.clear();
}


function scheduleSessionWebSocketExpiry(cacheKey: string, entry: SessionWebSocketCacheEntry): void {
	if (entry.idleTimer) {
		clearTimeout(entry.idleTimer);
	}
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "idle_timeout");
		websocketSessionCache.delete(cacheKey);
	}, SESSION_WEBSOCKET_CACHE_TTL_MS);
}

function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object" && "message" in event) {
		const message = (event as { message?: unknown | undefined }).message;
		if (typeof message === "string" && message.length > 0) {
			return new Error(message);
		}
	}
	return new Error("WebSocket error");
}

function extractWebSocketCloseError(event: unknown): Error {
	if (event && typeof event === "object") {
		const code = "code" in event ? (event as { code?: unknown | undefined }).code : undefined;
		const reason = "reason" in event ? (event as { reason?: unknown | undefined }).reason : undefined;
		const codeText = typeof code === "number" ? ` ${code}` : "";
		let reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
		if (!reasonText && code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE) {
			reasonText = " message too big";
		}
		return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
	}
	return new Error("WebSocket closed");
}

async function connectWebSocket(url: string, headers: Headers, signal: AbortSignal | undefined, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS): Promise<WebSocketLike> {
	const WebSocketCtor = await getWebSocketConstructor();
	if (!WebSocketCtor) {
		throw new Error("WebSocket transport is not available in this runtime");
	}

	const wsHeaders = headersToRecord(headers);
	delete wsHeaders["OpenAI-Beta"];

	return new Promise((resolve, reject) => {
		let settled = false;
		let timeout: ReturnType<typeof setTimeout> | undefined;
		let socket: WebSocketLike;

		try {
			socket = new WebSocketCtor(url, { headers: wsHeaders });
		} catch (error) {
			reject(error instanceof Error ? error : new Error(String(error)));
			return;
		}

		const onOpen = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(socket);
		};
		const onError = (event: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(extractWebSocketError(event));
		};
		const onClose = (event: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(extractWebSocketCloseError(event));
		};
		const onAbort = () => {
			if (settled) return;
			settled = true;
			cleanup();
			closeWebSocketSilently(socket, 1000, "aborted");
			reject(new Error("Request was aborted"));
		};

		const cleanup = () => {
			if (timeout) clearTimeout(timeout);
			socket.removeEventListener("open", onOpen);
			socket.removeEventListener("error", onError);
			socket.removeEventListener("close", onClose);
			signal?.removeEventListener("abort", onAbort);
		};

		socket.addEventListener("open", onOpen);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		signal?.addEventListener("abort", onAbort);
		if (connectTimeoutMs > 0) {
			timeout = setTimeout(() => {
				if (settled) return;
				settled = true;
				cleanup();
				closeWebSocketSilently(socket, 1000, "connect_timeout");
				reject(new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`));
			}, connectTimeoutMs);
		}
		if (signal?.aborted) onAbort();
	});
}

async function acquireWebSocket(
	url: string,
	headers: Headers,
	sessionId: string | undefined,
	signal: AbortSignal | undefined,
	connectTimeoutMs?: number,
): Promise<AcquiredWebSocket> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
		return {
			socket,
			reused: false,
			release: ({ keep } = {}) => {
				if (keep === false) {
					closeWebSocketSilently(socket);
					return;
				}
				closeWebSocketSilently(socket);
			},
		};
	}

	const cached = websocketSessionCache.get(sessionId);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = undefined;
		}

		if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				entry: cached,
				reused: true,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, cached);
				},
			};
		}

		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
			return {
				socket,
				reused: false,
				release: () => {
					closeWebSocketSilently(socket);
				},
			};
		}

		if (!isWebSocketReusable(cached.socket)) {
			closeWebSocketSilently(cached.socket);
			websocketSessionCache.delete(sessionId);
		}
	}

	const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs);
	const entry: SessionWebSocketCacheEntry = { socket, busy: true };
	websocketSessionCache.set(sessionId, entry);
	return {
		socket,
		entry,
		reused: false,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				if (websocketSessionCache.get(sessionId) === entry) {
					websocketSessionCache.delete(sessionId);
				}
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, entry);
		},
	};
}

async function decodeWebSocketData(data: unknown): Promise<string | null> {
	if (typeof data === "string") return data;
	if (data instanceof ArrayBuffer) {
		return new TextDecoder().decode(new Uint8Array(data));
	}
	if (ArrayBuffer.isView(data)) {
		return new TextDecoder().decode(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
	}
	if (data && typeof data === "object" && "arrayBuffer" in data) {
		const arrayBuffer = await (data as { arrayBuffer: () => Promise<ArrayBuffer> }).arrayBuffer();
		return new TextDecoder().decode(new Uint8Array(arrayBuffer));
	}
	return null;
}

async function* parseWebSocket(socket: WebSocketLike, signal: AbortSignal | undefined, idleTimeoutMs?: number): AsyncIterable<StreamEventShape> {
	const queue: StreamEventShape[] = [];
	let pending: (() => void) | null = null;
	let done = false;
	let failed: Error | null = null;
	let closeError: Error | null = null;
	let sawCompletion = false;
	let pendingMessages = 0;
	let messageChain = Promise.resolve();

	const wake = () => {
		if (!pending) return;
		const resolve = pending;
		pending = null;
		resolve();
	};

	const onMessage = (event: unknown) => {
		pendingMessages++;
		wake();
		messageChain = messageChain
			.then(async () => {
				if (!event || typeof event !== "object" || !("data" in event)) return;
				const text = await decodeWebSocketData((event as { data?: unknown | undefined }).data);
				if (!text) return;
				try {
					const parsed = JSON.parse(text) as StreamEventShape;
					const type = typeof parsed.type === "string" ? parsed.type : "";
					if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
						sawCompletion = true;
						closeError = null;
						done = true;
					}
					queue.push(parsed);
				} catch (error) {
					failed = new Error(`Invalid Codex WebSocket JSON: ${error instanceof Error ? error.message : String(error)}`);
					done = true;
				}
			})
			.catch((error: unknown) => {
				failed = error instanceof Error ? error : new Error(String(error));
				done = true;
			})
			.finally(() => {
				pendingMessages--;
				wake();
			});
	};

	const onError = (event: unknown) => {
		failed = extractWebSocketError(event);
		done = true;
		wake();
	};

	const onClose = (event: unknown) => {
		if (sawCompletion) {
			done = true;
			wake();
			return;
		}
		if (!closeError) {
			closeError = extractWebSocketCloseError(event);
		}
		done = true;
		wake();
	};

	const onAbort = () => {
		failed = new Error("Request was aborted");
		done = true;
		wake();
	};

	socket.addEventListener("message", onMessage);
	socket.addEventListener("error", onError);
	socket.addEventListener("close", onClose);
	signal?.addEventListener("abort", onAbort);

	try {
		while (true) {
			if (signal?.aborted) {
				throw new Error("Request was aborted");
			}
			if (queue.length > 0) {
				yield queue.shift() as StreamEventShape;
				continue;
			}
			if (done && pendingMessages === 0) break;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			await new Promise<void>((resolve) => {
				pending = resolve;
				if (pendingMessages === 0 && idleTimeoutMs && idleTimeoutMs > 0) {
					timeout = setTimeout(() => {
						failed = new Error(`WebSocket idle timeout after ${idleTimeoutMs}ms`);
						done = true;
						wake();
					}, idleTimeoutMs);
				}
			}).finally(() => {
				if (timeout) clearTimeout(timeout);
			});
		}

		if (failed) throw failed;
		if (closeError && !sawCompletion) throw closeError;
		if (!sawCompletion) {
			throw new Error("WebSocket stream closed before response.completed");
		}
	} finally {
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}

async function* countWebSocketEvents(
	events: AsyncIterable<StreamEventShape>,
	onEvent: () => void,
): AsyncIterable<StreamEventShape> {
	for await (const event of events) {
		onEvent();
		yield event;
	}
}

async function* startWebSocketOutputOnFirstEvent(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	onStart: () => void,
): AsyncIterable<StreamEventShape> {
	let started = false;
	for await (const event of events) {
		if (!started) {
			started = true;
			onStart();
			stream.push({ type: "start", partial: output });
		}
		yield event;
	}
}

function isRetryableEarlyWebSocketError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	if (/message too big/i.test(message)) return false;
	return /^(?:WebSocket (?:error|closed|connect timeout)(?:\s|$)|Invalid Codex WebSocket JSON)/.test(message);
}

async function* mapCodexEvents(events: AsyncIterable<StreamEventShape>): AsyncIterable<StreamEventShape> {
	let sawTerminalResponse = false;
	for await (const event of events) {
		const type = typeof event.type === "string" ? event.type : undefined;
		if (!type) continue;

		if (type === "error") {
			throw new Error(`Codex error: ${event.message || event.code || JSON.stringify(event)}`);
		}

		if (type === "response.failed") {
			throw new Error(event.response?.error?.message || "Codex response failed");
		}

		if (type === "response.done" || type === "response.completed" || type === "response.incomplete") {
			sawTerminalResponse = true;
			const response = event.response;
			yield {
				...event,
				type: "response.completed",
				response: response ? { ...response, status: normalizeCodexStatus(response.status) } : response,
			};
			return;
		}

		yield event;
	}

	if (!sawTerminalResponse) {
		throw new Error("Stream closed before response.completed");
	}
}

function normalizeCodexStatus(status: string | undefined): string | undefined {
	if (typeof status !== "string") return undefined;
	return CODEX_RESPONSE_STATUSES.has(status) ? status : undefined;
}

function getLatestUserText(context: Context): string | undefined {
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const message = context.messages[i]!;
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			const trimmed = message.content.trim();
			if (trimmed) return trimmed;
			continue;
		}
		const text = message.content
			.filter((item) => item.type === "text")
			.map((item) => item.text)
			.join("\n")
			.trim();
		if (text) return text;
	}
	return undefined;
}

async function* captureGeneratedImages(
	events: AsyncIterable<StreamEventShape>,
	options: {
		cwd: string;
		requestPrompt?: string | undefined;
		onImageSaved: (image: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
): AsyncIterable<StreamEventShape> {
	let responseId: string | undefined;

	for await (const event of events) {
		if (event.type === "response.created" && event.response?.id) {
			responseId = event.response.id;
		}

		if (event.type === "response.output_item.done" && event.item?.type === "image_generation_call") {
			const callId = typeof event.item.id === "string" ? event.item.id : undefined;
			const result = typeof event.item.result === "string" ? event.item.result : undefined;
			if (callId && result) {
				try {
					const outputFormat = typeof event.item.output_format === "string" ? event.item.output_format : undefined;
					const normalizedOutputFormat = normalizeImageOutputFormat(outputFormat);
					const saved = await saveOpenAICodexGeneratedImage(options.cwd, {
						responseId,
						callId,
						result,
						outputFormat: normalizedOutputFormat,
						revisedPrompt:
							typeof event.item.revised_prompt === "string" ? event.item.revised_prompt : options.requestPrompt,
					});
					options.onImageSaved(saved, {
						data: result,
						mimeType: `image/${normalizedOutputFormat}`,
					});
				} catch (error) {
					console.warn("[pi-codex-conversion] Failed to save generated image", error);
				}
			}
		}

		if (event.type === "response.output_item.done" && event.item?.type === "web_search_call") {
			const search = extractWebSearch(event.item);
			if (search) {
				options.onWebSearchCaptured?.(search);
			}
		}

		yield event;
	}
}

async function processCapturedResponsesStream<TApi extends Api>(
	events: AsyncIterable<StreamEventShape>,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	options: OpenAICodexStreamOptions | undefined,
	deps: {
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
	cwd: string,
	requestPrompt: string | undefined,
): Promise<void> {
	const tappedEvents = captureGeneratedImages(mapCodexEvents(events), {
		cwd,
		requestPrompt,
		onImageSaved: (image, imageData) => deps.onImageSaved?.(image, imageData),
		onWebSearchCaptured: (search) => deps.onWebSearchCaptured?.(search),
	});

	await processResponsesStream(tappedEvents as AsyncIterable<never>, output, stream, model, {
		serviceTier: (options as { serviceTier?: ServiceTier | undefined } | undefined)?.serviceTier,
		resolveServiceTier: resolveCodexServiceTier,
		applyServiceTierPricing: (usage, serviceTier) => applyServiceTierPricing(usage, serviceTier, model as Model<Api>),
	});
}

async function processWebSocketStream<TApi extends Api>(
	url: string,
	body: ResponsesBody,
	headers: Headers,
	output: AssistantMessage,
	stream: AssistantMessageEventStream,
	model: Model<TApi>,
	onStart: () => void,
	options: SimpleStreamOptions | undefined,
	deps: {
		onImageSaved?: (savedImage: SavedGeneratedImage, imageData: { data: string; mimeType: string }) => void | undefined;
		onWebSearchCaptured?: (search: SurfacedWebSearch) => void | undefined;
	},
	cwd: string,
	requestPrompt: string | undefined,
): Promise<void> {
	let streamStarted = false;
	const idleTimeoutMs = normalizeTimeoutMs(options?.timeoutMs, "timeoutMs");
	const websocketConnectTimeoutMs = normalizeTimeoutMs(options?.websocketConnectTimeoutMs, "websocketConnectTimeoutMs");

	for (let attempt = 0; attempt < 2; attempt++) {
		const { socket, entry, release } = await acquireWebSocket(url, headers, options?.sessionId, options?.signal, websocketConnectTimeoutMs);
		let keepConnection = true;
		let released = false;
		let eventCount = 0;
		const transport = (options as { transport?: string | undefined } | undefined)?.transport ?? "auto";
		const useCachedContext = transport === "websocket-cached" || transport === "auto";
		// ChatGPT Codex Responses rejects `store: true` ("Store must be set to false").
		// WebSocket continuation still works via connection-scoped previous_response_id state.
		const fullBody = body;
		const cachedRequest = useCachedContext && entry
			? buildCachedWebSocketRequestBody(entry.continuation, fullBody)
			: { body: fullBody, decision: useCachedContext ? "no_session_cache_entry" : "disabled" } satisfies CachedWebSocketRequestBodyResult;
		const requestBody = cachedRequest.body;

		const releaseOnce = (releaseOptions?: { keep?: boolean | undefined }) => {
			if (released) return;
			released = true;
			release(releaseOptions);
		};

		try {
			socket.send(JSON.stringify({ type: "response.create", ...requestBody }));
			await processCapturedResponsesStream(
				startWebSocketOutputOnFirstEvent(
					countWebSocketEvents(parseWebSocket(socket, options?.signal, idleTimeoutMs), () => {
						eventCount++;
					}),
					output,
					stream,
					() => {
						streamStarted = true;
						onStart();
					},
				),
				output,
				stream,
				model,
				options,
				deps,
				cwd,
				requestPrompt,
			);
			if (options?.signal?.aborted) {
				keepConnection = false;
			} else if (useCachedContext && entry && output.responseId) {
				const responseItems = convertResponsesMessages(model, { messages: [output] }, CODEX_TOOL_CALL_PROVIDERS, {
					includeSystemPrompt: false,
				}).filter((item) => typeof item === "object" && item !== null && (item as { type?: unknown | undefined }).type !== "function_call_output");
				entry.continuation = {
					lastRequestBody: fullBody,
					lastResponseId: output.responseId,
					lastResponseItems: responseItems,
				};
			}
			releaseOnce({ keep: keepConnection });
			return;
		} catch (error) {
			if (entry) {
				entry.continuation = undefined;
			}
			keepConnection = false;
			releaseOnce({ keep: false });
			// If WebSocket fails before the first response event, nothing has been
			// emitted to the UI/history yet. Retry once on a fresh WebSocket; if that
			// also fails, the caller can fall back to SSE for `auto` transport.
			if (attempt === 0 && eventCount === 0 && !streamStarted && !options?.signal?.aborted && isRetryableEarlyWebSocketError(error)) {
				continue;
			}
			throw error;
		} finally {
			releaseOnce({ keep: keepConnection });
		}
	}
}

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
