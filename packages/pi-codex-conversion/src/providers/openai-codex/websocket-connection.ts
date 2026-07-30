import { DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE } from "./constants.ts";
import { headersToRecord } from "./header-record.ts";
import type { ProviderEnv, WebSocketConstructorLike, WebSocketLike } from "./types.ts";

const dynamicImport = (specifier: string) => import(specifier);

const PROXY_ENV_KEYS = new Set([
	"all_proxy",
	"http_proxy",
	"https_proxy",
	"no_proxy",
	"npm_config_http_proxy",
	"npm_config_https_proxy",
	"npm_config_no_proxy",
	"npm_config_proxy",
]);

type GetProxyForUrl = (url: string | object | URL) => string;

let proxyFromEnvPromise: Promise<GetProxyForUrl> | undefined;
async function getProxyFromEnv(): Promise<GetProxyForUrl> {
	proxyFromEnvPromise ??= dynamicImport("proxy-from-env").then((module) => (module as { getProxyForUrl: GetProxyForUrl }).getProxyForUrl);
	return proxyFromEnvPromise;
}

let _cachedWebSocket: WebSocketConstructorLike | null = null;
async function getWebSocketConstructor(url: string, env?: ProviderEnv): Promise<WebSocketConstructorLike | null> {
	if (typeof process !== "undefined" && process.versions["bun"]!) {
		if (!env && _cachedWebSocket) return _cachedWebSocket;
		const getProxyForUrl = await getProxyFromEnv();
		const WebSocketWithProxy = class extends WebSocket {
			constructor(url: string, options?: { headers?: Record<string, string> | undefined } | string | string[]) {
				const proxy = resolveWebSocketProxyForTargetSync(getProxyForUrl, url, env);
				const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
				super(url, { ...baseOptions, ...(proxy ? { proxy } : {}) } as never);
			}
		};
		if (!env) _cachedWebSocket = WebSocketWithProxy;
		return WebSocketWithProxy;
	}
	const getProxyForUrl = await getProxyFromEnv();
	const proxy = resolveWebSocketProxyForTargetSync(getProxyForUrl, url, env);
	if (!proxy) {
		const ctor = (globalThis as typeof globalThis & { WebSocket?: WebSocketConstructorLike | undefined }).WebSocket;
		return typeof ctor === "function" ? ctor : null;
	}
	const proxyUrl = proxy;
	const { ProxyAgent, WebSocket: UndiciWebSocket } = await dynamicImport("undici") as typeof import("undici");
	const WebSocketWithProxy = class extends UndiciWebSocket {
		constructor(socketUrl: string, options?: { headers?: Record<string, string> | undefined } | string | string[]) {
			const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
			const dispatcher = new ProxyAgent(proxyUrl);
			super(socketUrl, { ...baseOptions, dispatcher } as never);
			let dispatcherClosed = false;
			const closeDispatcher = () => {
				if (dispatcherClosed) return;
				dispatcherClosed = true;
				void dispatcher.close();
			};
			this.addEventListener("error", closeDispatcher, { once: true });
			this.addEventListener("close", closeDispatcher, { once: true });
		}
	};
	return WebSocketWithProxy;
}

function proxyTargetUrl(url: string): string {
	return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

function scopedProxyEnv(env: ProviderEnv | undefined): Map<string, string> {
	const scoped = new Map<string, string>();
	for (const [key, value] of Object.entries(env ?? {})) {
		const normalized = key.toLowerCase();
		if (PROXY_ENV_KEYS.has(normalized)) scoped.set(normalized, value);
	}
	return scoped;
}

function withScopedProxyEnv<T>(env: ProviderEnv | undefined, run: () => T): T {
	if (typeof process === "undefined") return run();
	const scoped = scopedProxyEnv(env);
	if (scoped.size === 0) return run();

	const previous = new Map<string, string | undefined>();
	for (const [key, value] of scoped.entries()) {
		const upper = key.toUpperCase();
		previous.set(key, process.env[key]);
		previous.set(upper, process.env[upper]);
		delete process.env[key];
		delete process.env[upper];
		process.env[key] = value;
	}

	try {
		return run();
	} finally {
		for (const [key, value] of previous.entries()) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

function resolveWebSocketProxyForTargetSync(getProxyForUrl: GetProxyForUrl, url: string, env?: ProviderEnv): string | undefined {
	const proxy = withScopedProxyEnv(env, () => getProxyForUrl(proxyTargetUrl(url)));
	return proxy || undefined;
}

export async function resolveWebSocketProxyForTarget(url: string, env?: ProviderEnv): Promise<string | undefined> {
	return resolveWebSocketProxyForTargetSync(await getProxyFromEnv(), url, env);
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

function nestedWebSocketError(error: Error): Error {
	const wrapped = new Error(`WebSocket error: ${error.message}`, { cause: error }) as Error & { code?: string | number | undefined };
	wrapped.name = "WebSocketError";
	const code = (error as Error & { code?: unknown }).code;
	if (typeof code === "string" || typeof code === "number") wrapped.code = code;
	return wrapped;
}

function webSocketHttpStatus(value: unknown, seen = new Set<unknown>()): number | undefined {
	if (!value || typeof value !== "object" || seen.has(value)) return undefined;
	seen.add(value);
	const record = value as Record<string, unknown>;
	for (const candidate of [record["status"], record["statusCode"], record["status_code"], record["code"]]) {
		const parsed = typeof candidate === "string" && /^\d+$/.test(candidate) ? Number(candidate) : candidate;
		if (typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
	}
	return webSocketHttpStatus(record["error"], seen)
		?? webSocketHttpStatus(record["cause"], seen)
		?? webSocketHttpStatus(record["response"], seen);
}

function webSocketCloseCode(value: unknown, seen = new Set<unknown>()): number | undefined {
	if (!value || typeof value !== "object" || seen.has(value)) return undefined;
	seen.add(value);
	const record = value as Record<string, unknown>;
	for (const candidate of [record["closeCode"], record["code"]]) {
		const parsed = typeof candidate === "string" && /^\d+$/.test(candidate) ? Number(candidate) : candidate;
		if (typeof parsed === "number" && Number.isInteger(parsed) && parsed >= 1000 && parsed <= 4999) return parsed;
	}
	return webSocketCloseCode(record["error"], seen) ?? webSocketCloseCode(record["cause"], seen);
}

function webSocketStatus(error: unknown): number | undefined {
	const structured = webSocketHttpStatus(error);
	if (structured !== undefined) return structured;
	const message = error instanceof Error ? error.message : String(error);
	const match = /^(?:WebSocket error:\s*)?(?:Unexpected server response:\s*|HTTP(?:\/\d(?:\.\d)?)?\s+|WebSocket (?:handshake|upgrade)\b[^\n]*?\b)(\d{3})(?:\s+[^\n]*)?$/i.exec(message.trim());
	return match?.[1] ? Number(match[1]) : undefined;
}

export function isWebSocketUpgradeRequiredError(error: unknown): boolean {
	return webSocketStatus(error) === 426;
}

export function isWebSocketMessageTooBigError(error: unknown): boolean {
	if (webSocketCloseCode(error) === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE) return true;
	const message = error instanceof Error ? error.message : String(error);
	return /(?:\b1009\b|message too big)/i.test(message);
}

export function isPermanentWebSocketError(error: unknown): boolean {
	const status = webSocketStatus(error);
	return status === 400 || status === 429;
}

export function isWebSocketUnauthorizedError(error: unknown): boolean {
	return webSocketStatus(error) === 401;
}

export function extractWebSocketError(event: unknown): Error {
	if (event && typeof event === "object") {
		const message = "message" in event ? (event as { message?: unknown | undefined }).message : undefined;
		if (typeof message === "string" && message.length > 0) {
			const error = new Error(message) as Error & { status?: number | undefined };
			error.status = webSocketHttpStatus(event);
			return error;
		}
		const nestedError = "error" in event ? (event as { error?: unknown | undefined }).error : undefined;
		if (nestedError instanceof Error && nestedError.message.length > 0) return nestedWebSocketError(nestedError);
		if (nestedError && typeof nestedError === "object" && "message" in nestedError) {
			const nestedMessage = (nestedError as { message?: unknown | undefined }).message;
			if (typeof nestedMessage === "string" && nestedMessage.length > 0) return nestedWebSocketError(new Error(nestedMessage));
		}
	}
	return new Error("WebSocket error");
}

export class WebSocketCloseError extends Error {
	readonly code?: number | undefined;
	readonly reason?: string | undefined;

	constructor(message: string, options?: { code?: number | undefined; reason?: string | undefined }) {
		super(message);
		this.name = "WebSocketCloseError";
		this.code = options?.code;
		this.reason = options?.reason;
	}
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
		return new WebSocketCloseError(`WebSocket closed${codeText}${reasonText}`.trim(), {
			code: typeof code === "number" ? code : undefined,
			reason: typeof reason === "string" && reason.length > 0 ? reason : undefined,
		});
	}
	return new Error("WebSocket closed");
}

export async function connectWebSocket(url: string, headers: Headers, signal: AbortSignal | undefined, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, env?: ProviderEnv): Promise<WebSocketLike> {
	const WebSocketCtor = await getWebSocketConstructor(url, env);
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
