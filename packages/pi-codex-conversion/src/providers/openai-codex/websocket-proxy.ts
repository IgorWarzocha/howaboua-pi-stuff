import type { ProviderEnv } from "./types.ts";
import { captureWebSocketMessageLimit } from "./websocket-size.ts";

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

const dynamicImport = (specifier: string) => import(specifier);
let proxyFromEnvPromise: Promise<GetProxyForUrl> | undefined;
function getProxyFromEnv(): Promise<GetProxyForUrl> {
	proxyFromEnvPromise ??= dynamicImport("proxy-from-env").then(
		(module) => (module as { getProxyForUrl: GetProxyForUrl }).getProxyForUrl,
	);
	return proxyFromEnvPromise;
}

export async function createWebSocket(
	url: string,
	headers: Record<string, string>,
	env?: ProviderEnv,
	signal?: AbortSignal,
) {
	const [{ WebSocket }, proxy] = await Promise.all([
		import("ws"),
		resolveWebSocketProxyForTarget(url, env),
	]);
	const tunnel = proxy ? await createProxyTunnel(proxy) : undefined;
	if (signal?.aborted) {
		tunnel?.close();
		throw new Error("Request was aborted");
	}
	try {
		const socket = new WebSocket(url, { headers, agent: tunnel?.agent });
		socket.once("upgrade", (response) => {
			captureWebSocketMessageLimit(
				socket,
				response.headers["x-codex-websocket-max-message-bytes"],
			);
		});
		// ws emits errors even after abort or listener removal.
		socket.on("error", () => {});
		if (tunnel) socket.once("close", tunnel.close);
		return socket;
	} catch (error) {
		tunnel?.close();
		throw error;
	}
}

async function createProxyTunnel(proxy: string) {
	const { HttpsProxyAgent } = await import("https-proxy-agent");
	const url = new URL(proxy);
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("WebSocket proxy URL must use HTTP or HTTPS");
	}
	const lifetime = new AbortController();
	const options = { signal: lifetime.signal, keepAlive: false };
	const agent =
		url.protocol === "https:"
			? new HttpsProxyAgent<"https:">(url, options)
			: new HttpsProxyAgent<"http:">(url, options);
	return {
		agent,
		close() {
			// The agent does not yet own the proxy socket while CONNECT is pending.
			lifetime.abort();
			agent.destroy();
		},
	};
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

function resolveWebSocketProxyForTargetSync(
	getProxyForUrl: GetProxyForUrl,
	url: string,
	env?: ProviderEnv,
): string | undefined {
	const proxy = withScopedProxyEnv(env, () =>
		getProxyForUrl(proxyTargetUrl(url)),
	);
	return proxy || undefined;
}

export async function resolveWebSocketProxyForTarget(
	url: string,
	env?: ProviderEnv,
): Promise<string | undefined> {
	return resolveWebSocketProxyForTargetSync(await getProxyFromEnv(), url, env);
}
