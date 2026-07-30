import type { StreamEventShape, WebSocketLike } from "./types.ts";
import { DEFAULT_WEBSOCKET_CLOSE_TIMEOUT_MS } from "./constants.ts";
import { extractWebSocketCloseError, extractWebSocketError, isWebSocketMessageTooBigError } from "./websocket-connection.ts";
import { extractCodexTurnStateFromWebSocketEvent } from "./turn-state.ts";

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

export async function* parseWebSocket(socket: WebSocketLike, signal: AbortSignal | undefined, idleTimeoutMs?: number, onTurnState?: (value: string) => void): AsyncIterable<StreamEventShape> {
	const queue: StreamEventShape[] = [];
	let pending: (() => void) | null = null;
	let done = false;
	let failed: Error | null = null;
	let closeError: Error | null = null;
	let sawCompletion = false;
	let idleTimedOut = false;
	let pendingMessages = 0;
	let messageChain = Promise.resolve();
	let socketError: Error | null = null;
	let socketErrorTimer: ReturnType<typeof setTimeout> | undefined;

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
				let parsed: StreamEventShape;
				try {
					parsed = JSON.parse(text) as StreamEventShape;
				} catch {
					// Codex ignores malformed individual events and keeps the live stream.
					return;
				}
				const turnState = extractCodexTurnStateFromWebSocketEvent(parsed);
				if (turnState) onTurnState?.(turnState);
				const type = typeof parsed.type === "string" ? parsed.type : "";
				if (type === "response.completed" || type === "response.done" || type === "response.incomplete") {
					sawCompletion = true;
					closeError = null;
					done = true;
				}
				queue.push(parsed);
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
		socketError = extractWebSocketError(event);
		if (socketErrorTimer) clearTimeout(socketErrorTimer);
		socketErrorTimer = setTimeout(() => {
			failed = socketError;
			done = true;
			wake();
		}, DEFAULT_WEBSOCKET_CLOSE_TIMEOUT_MS);
	};

	const onClose = (event: unknown) => {
		if (socketErrorTimer) clearTimeout(socketErrorTimer);
		if (sawCompletion) {
			done = true;
			wake();
			return;
		}
		if (!closeError) {
			const error = extractWebSocketCloseError(event);
			if (isWebSocketMessageTooBigError(error)) {
				failed = null;
				closeError = error;
			} else if (socketError) {
				failed = socketError;
			} else {
				closeError = error;
			}
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
			if (failed && (pendingMessages === 0 || idleTimedOut)) break;
			if (done && pendingMessages === 0) break;
			let timeout: ReturnType<typeof setTimeout> | undefined;
			await new Promise<void>((resolve) => {
				pending = resolve;
				if (idleTimeoutMs && idleTimeoutMs > 0) {
					timeout = setTimeout(() => {
						idleTimedOut = true;
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
		if (socketErrorTimer) clearTimeout(socketErrorTimer);
		socket.removeEventListener("message", onMessage);
		socket.removeEventListener("error", onError);
		socket.removeEventListener("close", onClose);
		signal?.removeEventListener("abort", onAbort);
	}
}

export async function* startWebSocketOutputOnFirstEvent(
	events: AsyncIterable<StreamEventShape>,
	onStart: () => void,
): AsyncIterable<StreamEventShape> {
	let started = false;
	for await (const event of events) {
		if (!started) {
			started = true;
			onStart();
		}
		yield event;
	}
}
