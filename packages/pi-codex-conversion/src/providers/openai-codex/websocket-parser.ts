import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { StreamEventShape, WebSocketLike } from "./types.ts";
import { extractWebSocketCloseError, extractWebSocketError } from "./websocket-connection.ts";

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
