import { DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE } from "./constants.ts";
import { headersToRecord } from "./headers.ts";
import type { WebSocketConstructorLike, WebSocketLike } from "./types.ts";

const dynamicImport = (specifier: string) => import(specifier);

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

export async function connectWebSocket(url: string, headers: Headers, signal: AbortSignal | undefined, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS): Promise<WebSocketLike> {
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
