var __rewriteRelativeImportExtension = (this && this.__rewriteRelativeImportExtension) || function (path, preserveJsx) {
    if (typeof path === "string" && /^\.\.?\//.test(path)) {
        return path.replace(/\.(tsx)$|((?:\.d)?)((?:\.[^./]+?)?)\.([cm]?)ts$/i, function (m, tsx, d, ext, cm) {
            return tsx ? preserveJsx ? ".jsx" : ".js" : d && (!ext || !cm) ? m : (d + ext + "." + cm.toLowerCase() + "js");
        });
    }
    return path;
};
import { DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE } from "./constants.js";
import { headersToRecord } from "./headers.js";
const dynamicImport = (specifier) => import(__rewriteRelativeImportExtension(specifier));
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
let proxyFromEnvPromise;
async function getProxyFromEnv() {
    proxyFromEnvPromise ??= dynamicImport("proxy-from-env").then((module) => module.getProxyForUrl);
    return proxyFromEnvPromise;
}
let _cachedWebSocket = null;
async function getWebSocketConstructor(env) {
    if (!env && _cachedWebSocket)
        return _cachedWebSocket;
    if (typeof process !== "undefined" && process.versions["bun"]) {
        const getProxyForUrl = await getProxyFromEnv();
        const WebSocketWithProxy = class extends WebSocket {
            constructor(url, options) {
                const proxy = resolveWebSocketProxyForTargetSync(getProxyForUrl, url, env);
                const baseOptions = Array.isArray(options) || typeof options === "string" ? { protocols: options } : { ...options };
                super(url, { ...baseOptions, ...(proxy ? { proxy } : {}) });
            }
        };
        if (!env)
            _cachedWebSocket = WebSocketWithProxy;
        return WebSocketWithProxy;
    }
    const ctor = globalThis.WebSocket;
    return typeof ctor === "function" ? ctor : null;
}
function proxyTargetUrl(url) {
    return url.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}
function scopedProxyEnv(env) {
    const scoped = new Map();
    for (const [key, value] of Object.entries(env ?? {})) {
        const normalized = key.toLowerCase();
        if (PROXY_ENV_KEYS.has(normalized))
            scoped.set(normalized, value);
    }
    return scoped;
}
function withScopedProxyEnv(env, run) {
    if (typeof process === "undefined")
        return run();
    const scoped = scopedProxyEnv(env);
    if (scoped.size === 0)
        return run();
    const previous = new Map();
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
    }
    finally {
        for (const [key, value] of previous.entries()) {
            if (value === undefined)
                delete process.env[key];
            else
                process.env[key] = value;
        }
    }
}
function resolveWebSocketProxyForTargetSync(getProxyForUrl, url, env) {
    const proxy = withScopedProxyEnv(env, () => getProxyForUrl(proxyTargetUrl(url)));
    return proxy || undefined;
}
export async function resolveWebSocketProxyForTarget(url, env) {
    return resolveWebSocketProxyForTargetSync(await getProxyFromEnv(), url, env);
}
function getWebSocketReadyState(socket) {
    return typeof socket.readyState === "number" ? socket.readyState : undefined;
}
export function isWebSocketReusable(socket) {
    const readyState = getWebSocketReadyState(socket);
    return readyState === undefined || readyState === 1;
}
export function closeWebSocketSilently(socket, code = 1000, reason = "done") {
    try {
        socket.close(code, reason);
    }
    catch {
        // ignore close errors
    }
}
export function extractWebSocketError(event) {
    if (event && typeof event === "object" && "message" in event) {
        const message = event.message;
        if (typeof message === "string" && message.length > 0) {
            return new Error(message);
        }
    }
    return new Error("WebSocket error");
}
export function extractWebSocketCloseError(event) {
    if (event && typeof event === "object") {
        const code = "code" in event ? event.code : undefined;
        const reason = "reason" in event ? event.reason : undefined;
        const codeText = typeof code === "number" ? ` ${code}` : "";
        let reasonText = typeof reason === "string" && reason.length > 0 ? ` ${reason}` : "";
        if (!reasonText && code === WEBSOCKET_MESSAGE_TOO_BIG_CLOSE_CODE) {
            reasonText = " message too big";
        }
        return new Error(`WebSocket closed${codeText}${reasonText}`.trim());
    }
    return new Error("WebSocket closed");
}
export async function connectWebSocket(url, headers, signal, connectTimeoutMs = DEFAULT_WEBSOCKET_CONNECT_TIMEOUT_MS, env) {
    const WebSocketCtor = await getWebSocketConstructor(env);
    if (!WebSocketCtor) {
        throw new Error("WebSocket transport is not available in this runtime");
    }
    const wsHeaders = headersToRecord(headers);
    delete wsHeaders["OpenAI-Beta"];
    return new Promise((resolve, reject) => {
        let settled = false;
        let timeout;
        let socket;
        try {
            socket = new WebSocketCtor(url, { headers: wsHeaders });
        }
        catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
            return;
        }
        const onOpen = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            resolve(socket);
        };
        const onError = (event) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(extractWebSocketError(event));
        };
        const onClose = (event) => {
            if (settled)
                return;
            settled = true;
            cleanup();
            reject(extractWebSocketCloseError(event));
        };
        const onAbort = () => {
            if (settled)
                return;
            settled = true;
            cleanup();
            closeWebSocketSilently(socket, 1000, "aborted");
            reject(new Error("Request was aborted"));
        };
        const cleanup = () => {
            if (timeout)
                clearTimeout(timeout);
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
                if (settled)
                    return;
                settled = true;
                cleanup();
                closeWebSocketSilently(socket, 1000, "connect_timeout");
                reject(new Error(`WebSocket connect timeout after ${connectTimeoutMs}ms`));
            }, connectTimeoutMs);
        }
        if (signal?.aborted)
            onAbort();
    });
}
