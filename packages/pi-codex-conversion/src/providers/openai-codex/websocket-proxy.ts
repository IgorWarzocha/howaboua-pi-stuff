import type { ProviderEnv, WebSocketConstructorLike } from "./types.ts";

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
export async function getWebSocketConstructor(url: string, env?: ProviderEnv): Promise<WebSocketConstructorLike | null> {
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
