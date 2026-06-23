import { DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE } from "./constants.ts";
import { headersToRecord } from "./headers.ts";
import type { ProviderEnv, WebSocketConstructorLike, WebSocketLike } from "./types.ts";

let _cachedWebSocket: WebSocketConstructorLike | null = null;
async function getWebSocketConstructor(env?: ProviderEnv): Promise<WebSocketConstructorLike | null> {
	if (!env && _cachedWebSocket) return _cachedWebSocket;
	if (typeof process !== "undefined" && process.versions["bun"]!) {
		const WebSocketWithProxy = class extends WebSocket {
			constructor(url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]) {
				const proxy = resolveWebSocketProxyForTarget(url, env);
				const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
				super(url, { ...baseOptions, ...(proxy ? { proxy } : {}) } as never);
			}
		};
		if (!env) _cachedWebSocket = WebSocketWithProxy;
		return WebSocketWithProxy;
	}
	const ctor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructorLike | undefined }).WebSocket;
	return typeof ctor === "function" ? ctor : null;
}

function envValue(env: ProviderEnv | undefined, name: string): string | undefined {
	return env?.[name] ?? (typeof process !== "undefined" ? process.env[name] : undefined);
}

function noProxyMatches(noProxy: string | undefined, target: URL): boolean {
	if (!noProxy) return false;
	for (const raw of noProxy.split(",")) {
		const entry = raw.trim().toLowerCase();
		if (!entry) continue;
		if (entry === "*") return true;
		const [hostPattern, port] = entry.split(":", 2);
		if (port && port !== target.port) continue;
		const hostname = target.hostname.toLowerCase();
		if (hostPattern?.startsWith(".")) {
			if (hostname.endsWith(hostPattern)) return true;
		} else if (hostname === hostPattern || hostname.endsWith(`.${hostPattern}`)) {
			return true;
		}
	}
	return false;
}

export function resolveWebSocketProxyForTarget(url: string, env?: ProviderEnv): string | undefined {
	const target = new URL(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"));
	if (noProxyMatches(envValue(env, "NO_PROXY") ?? envValue(env, "no_proxy"), target)) return undefined;
	const proxy = target.protocol === "https:"
		? envValue(env, "HTTPS_PROXY") ?? envValue(env, "https_proxy") ?? envValue(env, "ALL_PROXY") ?? envValue(env, "all_proxy")
		: envValue(env, "HTTP_PROXY") ?? envValue(env, "http_proxy") ?? envValue(env, "ALL_PROXY") ?? envValue(env, "all_proxy");
	return proxy && proxy.trim() ? proxy.trim() : undefined;
}

function getWebSocketReadyState(socket: WebSocketLike): number | undefined {
	return typeof socket.readyState === "number" ? socket.readyState : undefined;
}

export function isWebSocketReusable(socket: WebSocketLike): boolean {
	const readyState = getWebSocketReadyState(socket);
	return readyState === undefined || readyState === 1;
}

export function closeWebSocketSilently(socket: WebSocketLike, code = 1000, reason = "done"): void {
	try {
		socket.close(code, reason);
	} catch {
		// ignore close errors
	}
}



export function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object" && "message" in event) {
		const message = (event as { message?: unknown | undefined }).message;
		if (typeof message === "string" && message.length > 0) {
			return new Error(message);
		}
	}
	return new Error("WebSocket error");
}

export function extractWebSocketCloseError(event: unknown): Error {
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

export async function connectWebSocket(url: string, headers: Headers, signal: AbortSignal | undefined, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, env?: ProviderEnv): Promise<WebSocketLike> {
	const WebSocketCtor = await getWebSocketConstructor(env);
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
