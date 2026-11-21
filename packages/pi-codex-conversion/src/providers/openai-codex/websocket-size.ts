import type { WebSocketLike } from "./types.ts";

const messageLimits = new WeakMap<WebSocketLike, bigint>();
const MAX_U64 = (1n << 64n) - 1n;

export function captureWebSocketMessageLimit(
	socket: WebSocketLike,
	value: string | string[] | undefined,
): void {
	if (typeof value !== "string" || !/^\+?\d+$/.test(value)) return;
	const limit = BigInt(value);
	if (limit <= MAX_U64) messageLimits.set(socket, limit);
}

// Only a local preflight rejection or a close before the first text frame
// identifies a request that should skip WebSocket retries.
export class WebSocketMessageTooBigError extends Error {
	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "WebSocketMessageTooBigError";
	}
}

export function sendWebSocketRequest(
	socket: WebSocketLike,
	json: string,
	onRequestBytes?: (bytes: number) => void,
): void {
	const limit = messageLimits.get(socket);
	if (limit !== undefined || onRequestBytes) {
		const bytes = Buffer.byteLength(json, "utf8");
		onRequestBytes?.(bytes);
		if (limit !== undefined && bytes > limit) {
			throw new WebSocketMessageTooBigError(
				`WebSocket message too big: ${bytes} bytes, limit ${limit} bytes`,
			);
		}
	}
	socket.send(json);
}
