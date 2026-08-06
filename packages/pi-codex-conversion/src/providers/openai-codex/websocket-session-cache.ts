import type { AcquiredWebSocket, ProviderEnv, SessionWebSocketCacheEntry } from "./types.ts";
import { closeWebSocketSilently, connectWebSocket, isWebSocketReusable } from "./websocket-connection.ts";

const websocketSessionCache = new Map<string, Map<string, SessionWebSocketCacheEntry>>();
const websocketSseFallbackSessions = new Set<string>();
const SESSION_WEBSOCKET_MAX_AGE_MS = 55 * 60 * 1000;

export function isWebSocketSseFallbackActive(sessionId: string | undefined): boolean {
	return sessionId ? websocketSseFallbackSessions.has(sessionId) : false;
}

export function recordWebSocketSseFallback(sessionId: string | undefined): void {
	if (sessionId) websocketSseFallbackSessions.add(sessionId);
}

function isWebSocketSessionExpired(entry: SessionWebSocketCacheEntry): boolean {
	return Date.now() - entry.createdAt >= SESSION_WEBSOCKET_MAX_AGE_MS;
}

function scheduleSessionWebSocketExpiry(sessionId: string, accountId: string, entry: SessionWebSocketCacheEntry): void {
	if (entry.idleTimer) {
		clearTimeout(entry.idleTimer);
	}
	const remainingLifetimeMs = Math.max(0, SESSION_WEBSOCKET_MAX_AGE_MS - (Date.now() - entry.createdAt));
	entry.idleTimer = setTimeout(() => {
		if (entry.busy) return;
		closeWebSocketSilently(entry.socket, 1000, "connection_age_limit");
		const accountEntries = websocketSessionCache.get(sessionId);
		if (accountEntries?.get(accountId) === entry) accountEntries.delete(accountId);
		if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
	}, remainingLifetimeMs);
}

function closeWebSocketSessions(sessionId: string | undefined): void {
	const closeEntry = (entry: SessionWebSocketCacheEntry) => {
		if (entry.idleTimer) {
			clearTimeout(entry.idleTimer);
			entry.idleTimer = undefined;
		}
		closeWebSocketSilently(entry.socket, 1000, "session_shutdown");
	};

	if (sessionId) {
		for (const entry of websocketSessionCache.get(sessionId)?.values() ?? []) closeEntry(entry);
		websocketSessionCache.delete(sessionId);
		return;
	}

	for (const accountEntries of websocketSessionCache.values()) {
		for (const entry of accountEntries.values()) closeEntry(entry);
	}
	websocketSessionCache.clear();
}

export function resetOpenAICodexWebSocketSessions(sessionId?: string): void {
	closeWebSocketSessions(sessionId);
}

export function closeOpenAICodexWebSocketSessions(sessionId?: string): void {
	closeWebSocketSessions(sessionId);
	if (sessionId) {
		websocketSseFallbackSessions.delete(sessionId);
		return;
	}
	websocketSseFallbackSessions.clear();
}

export async function acquireWebSocket(
	url: string,
	headers: Headers,
	sessionId: string | undefined,
	accountId: string,
	signal: AbortSignal | undefined,
	connectTimeoutMs?: number,
	env?: ProviderEnv,
): Promise<AcquiredWebSocket> {
	if (!sessionId) {
		const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
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

	let accountEntries = websocketSessionCache.get(sessionId);
	const cached = accountEntries?.get(accountId);
	if (cached) {
		if (cached.idleTimer) {
			clearTimeout(cached.idleTimer);
			cached.idleTimer = undefined;
		}

		if (!cached.busy && isWebSocketSessionExpired(cached)) {
			closeWebSocketSilently(cached.socket, 1000, "connection_age_limit");
			accountEntries?.delete(accountId);
			if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
		} else if (!cached.busy && isWebSocketReusable(cached.socket)) {
			cached.busy = true;
			return {
				socket: cached.socket,
				entry: cached,
				reused: true,
				release: ({ keep } = {}) => {
					if (!keep || !isWebSocketReusable(cached.socket)) {
						closeWebSocketSilently(cached.socket);
						const currentEntries = websocketSessionCache.get(sessionId);
						if (currentEntries?.get(accountId) === cached) currentEntries.delete(accountId);
						if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
						return;
					}
					cached.busy = false;
					scheduleSessionWebSocketExpiry(sessionId, accountId, cached);
				},
			};
		}

		if (cached.busy) {
			const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
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
			accountEntries?.delete(accountId);
			if (accountEntries?.size === 0) websocketSessionCache.delete(sessionId);
		}
	}

	const socket = await connectWebSocket(url, headers, signal, connectTimeoutMs, env);
	const entry: SessionWebSocketCacheEntry = { socket, busy: true, createdAt: Date.now() };
	accountEntries = websocketSessionCache.get(sessionId);
	if (!accountEntries) {
		accountEntries = new Map();
		websocketSessionCache.set(sessionId, accountEntries);
	}
	accountEntries.set(accountId, entry);
	return {
		socket,
		entry,
		reused: false,
		release: ({ keep } = {}) => {
			if (!keep || !isWebSocketReusable(entry.socket)) {
				closeWebSocketSilently(entry.socket);
				if (entry.idleTimer) clearTimeout(entry.idleTimer);
				const currentEntries = websocketSessionCache.get(sessionId);
				if (currentEntries?.get(accountId) === entry) currentEntries.delete(accountId);
				if (currentEntries?.size === 0) websocketSessionCache.delete(sessionId);
				return;
			}
			entry.busy = false;
			scheduleSessionWebSocketExpiry(sessionId, accountId, entry);
		},
	};
}
