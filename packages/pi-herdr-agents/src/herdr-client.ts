import { createConnection } from "node:net";
import type { HerdrEvent } from "./types.js";

const MAX_FRAME_BUFFER = 8 * 1024 * 1024;

function socketEndpoint(socketPath: string): string {
	return process.platform === "win32"
		? `\\\\.\\pipe\\${socketPath}`
		: socketPath;
}

function errorFromResponse(value: unknown): Error {
	if (
		typeof value === "object" &&
		value !== null &&
		"message" in value &&
		typeof value.message === "string"
	) {
		const error = new Error(value.message) as Error & { code?: string };
		if ("code" in value && typeof value.code === "string") {
			error.code = value.code;
		}
		return error;
	}
	return new Error(`Herdr request failed: ${JSON.stringify(value)}`);
}

export class HerdrClient {
	readonly socketPath: string;

	constructor(socketPath = process.env["HERDR_SOCKET_PATH"]) {
		if (!socketPath) {
			throw new Error(
				"HERDR_SOCKET_PATH is not set; run the controlling Pi session inside Herdr",
			);
		}
		this.socketPath = socketPath;
	}

	request<T>(
		method: string,
		params: object = {},
		timeoutMs = 10_000,
	): Promise<T> {
		return new Promise((resolve, reject) => {
			const id = `pi-herdr-agents:${crypto.randomUUID()}`;
			let buffer = "";
			let settled = false;
			const socket = createConnection(socketEndpoint(this.socketPath));
			socket.setEncoding("utf8");
			const timer = setTimeout(
				() => finish(new Error(`Herdr ${method} timed out`)),
				timeoutMs,
			);
			timer.unref();

			const finish = (error?: Error, result?: T) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				socket.destroy();
				if (error) reject(error);
				else resolve(result as T);
			};

			socket.on("connect", () => {
				socket.write(`${JSON.stringify({ id, method, params })}\n`);
			});
			socket.on("error", (error) => finish(error));
			socket.on("end", () => finish(new Error(`Herdr ${method} disconnected`)));
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				if (buffer.length > MAX_FRAME_BUFFER) {
					finish(new Error(`Herdr ${method} response is too large`));
					return;
				}
				const newline = buffer.indexOf("\n");
				if (newline < 0) return;
				try {
					const response = JSON.parse(buffer.slice(0, newline)) as {
						id?: unknown;
						error?: unknown;
						result?: T;
					};
					if (response.id !== id)
						finish(
							new Error(`Herdr ${method} returned a mismatched response ID`),
						);
					else if (response.error !== undefined)
						finish(errorFromResponse(response.error));
					else if (response.result !== undefined)
						finish(undefined, response.result);
					else finish(new Error(`Herdr ${method} returned no result`));
				} catch (error) {
					finish(
						new Error(
							`Herdr ${method} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
						),
					);
				}
			});
		});
	}

	subscribe(
		subscriptions: object[],
		onEvent: (event: HerdrEvent) => void,
		onDisconnect: (error?: Error) => void,
	): Promise<() => void> {
		return new Promise((resolve, reject) => {
			const id = `pi-herdr-agents:subscribe:${crypto.randomUUID()}`;
			let acknowledged = false;
			let buffer = "";
			let closed = false;
			let disconnected = false;
			const socket = createConnection(socketEndpoint(this.socketPath));
			socket.setEncoding("utf8");
			const timer = setTimeout(() => {
				const error = new Error("Herdr events.subscribe timed out");
				socket.destroy();
				reject(error);
			}, 10_000);
			timer.unref();

			const disconnect = (error?: Error) => {
				if (disconnected) return;
				disconnected = true;
				clearTimeout(timer);
				if (!acknowledged)
					reject(error ?? new Error("Herdr subscription disconnected"));
				else if (!closed) onDisconnect(error);
			};

			socket.on("connect", () => {
				socket.write(
					`${JSON.stringify({ id, method: "events.subscribe", params: { subscriptions } })}\n`,
				);
			});
			socket.on("error", disconnect);
			socket.on("end", () => disconnect());
			socket.on("close", () => disconnect());
			socket.on("data", (chunk: string) => {
				buffer += chunk;
				if (buffer.length > MAX_FRAME_BUFFER) {
					disconnect(new Error("Herdr event frame is too large"));
					socket.destroy();
					return;
				}
				for (;;) {
					const newline = buffer.indexOf("\n");
					if (newline < 0) break;
					const line = buffer.slice(0, newline);
					buffer = buffer.slice(newline + 1);
					if (!line) continue;
					let value: Record<string, unknown>;
					try {
						value = JSON.parse(line) as Record<string, unknown>;
					} catch (error) {
						disconnect(
							new Error(
								`Herdr events.subscribe returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
							),
						);
						socket.destroy();
						return;
					}
					if (!acknowledged && value["id"] === id) {
						if (value["error"] !== undefined) {
							disconnect(errorFromResponse(value["error"]));
							socket.destroy();
							return;
						}
						acknowledged = true;
						clearTimeout(timer);
						resolve(() => {
							closed = true;
							socket.destroy();
						});
						continue;
					}
					if (
						acknowledged &&
						typeof value["event"] === "string" &&
						typeof value["data"] === "object" &&
						value["data"] !== null
					) {
						onEvent({
							event: value["event"],
							data: value["data"] as Record<string, unknown>,
						});
					}
				}
			});
		});
	}
}
