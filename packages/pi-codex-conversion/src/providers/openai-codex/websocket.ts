import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import { DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, SESSION_WEBSOCKET_CACHE_TTL_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE } from "./constants.ts";
import { headersToRecord } from "./headers.ts";
import type { AcquiredWebSocket, OpenAICodexStreamOptions, SessionWebSocketCacheEntry, StreamEventShape, WebSocketConstructorLike, WebSocketLike } from "./types.ts";
import { normalizeTimeoutMs } from "./sse.ts";

const dynamicImport = (specifier: string) => import(specifier);
const websocketSessionCache = new Map<string, SessionWebSocketCacheEntry>();

export function validateWebSocketTimeoutOptions(options: OpenAICodexStreamOptions | undefined): void {
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

export async function acquireWebSocket(
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

export async function* parseWebSocket(socket: WebSocketLike, signal: AbortSignal | undefined, idleTimeoutMs?: number): AsyncIterable<StreamEventShape> {
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

export async function* countWebSocketEvents(
	events: AsyncIterable<StreamEventShape>,
	onEvent: () => void,
): AsyncIterable<StreamEventShape> {
	for await (const event of events) {
		onEvent();
		yield event;
	}
}

export async function* startWebSocketOutputOnFirstEvent(
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

export function isRetryableEarlyWebSocketError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	if (/message too big/i.test(message)) return false;
	return /^(?:WebSocket (?:error|closed|connect timeout)(?:\s|$)|Invalid Codex WebSocket JSON)/.test(message);
}
