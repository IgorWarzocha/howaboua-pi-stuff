import { SESSION_WEBSOCKET_CACHE_TTL_MS } from "./constants.ts";
import type { AcquiredWebSocket, SessionWebSocketCacheEntry } from "./types.ts";
import { closeWebSocketSilently, connectWebSocket, isWebSocketReusable } from "./websocket-connection.ts";

const websocketSessionCache = new Map<string, SessionWebSocketCacheEntry>();

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
