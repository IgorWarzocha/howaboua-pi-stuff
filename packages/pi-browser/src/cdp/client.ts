import { CDP_TIMEOUT_MS, sleep } from "./discovery.js";
import type { CdpConnection, CdpEventWait, CdpParams } from "./types.js";
import { asRecord, errorMessage } from "./types.js";

const RETRYABLE_TIMEOUT_METHODS = new Set([
	"Accessibility.getFullAXTree",
	"Page.captureScreenshot",
	"Runtime.enable",
]);

interface PendingCommand {
	resolve(value: unknown): void;
	reject(error: unknown): void;
	timer: ReturnType<typeof setTimeout>;
	abort?: (() => void) | undefined;
	signal?: AbortSignal | undefined;
}

type EventHandler = (params: unknown) => void;

class CdpTimeoutError extends Error {}

function cdpTimeoutAttempts(method: string): number {
	return RETRYABLE_TIMEOUT_METHODS.has(method) ? 2 : 1;
}

function timeoutError(method: string, attempts: number): Error {
	const seconds = CDP_TIMEOUT_MS / 1_000;
	if (attempts > 1) {
		return new Error(
			`Chrome did not answer ${method} after two ${seconds}s attempts. The tab may be unresponsive or suspended.`,
		);
	}
	if (method === "Runtime.evaluate") {
		return new Error(
			`Chrome did not answer Runtime.evaluate within ${seconds}s. The expression or awaited promise may still be running; check its effect before retrying.`,
		);
	}
	return new Error(`Chrome did not answer ${method} within ${seconds}s.`);
}

export class CdpClient implements CdpConnection {
	private socket: WebSocket | undefined;
	private nextId = 0;
	private readonly pending = new Map<number, PendingCommand>();
	private readonly eventHandlers = new Map<string, Set<EventHandler>>();
	private readonly closeHandlers = new Set<() => void>();

	async connect(url: string, signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) {
			throw signal.reason ?? new Error("CDP connection aborted");
		}
		await new Promise<void>((resolveValue, reject) => {
			const socket = new WebSocket(url);
			this.socket = socket;
			let settled = false;
			const cleanup = () => signal?.removeEventListener("abort", abort);
			const fail = (error: unknown) => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(error);
			};
			const abort = () => {
				socket.close();
				fail(signal?.reason ?? new Error("CDP connection aborted"));
			};
			signal?.addEventListener("abort", abort, { once: true });
			socket.onopen = () => {
				if (settled) return;
				settled = true;
				cleanup();
				resolveValue();
			};
			socket.onerror = (event) =>
				fail(
					new Error(
						`WebSocket error: ${"message" in event ? String(event.message) : event.type}`,
					),
				);
			socket.onmessage = (event) => this.handleMessage(event.data);
			socket.onclose = () => this.handleClose();
		});
	}

	async send(
		method: string,
		params: CdpParams = {},
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		const attempts = cdpTimeoutAttempts(method);
		for (let attempt = 1; attempt <= attempts; attempt++) {
			try {
				return await this.sendOnce(method, params, sessionId, signal);
			} catch (error) {
				if (!(error instanceof CdpTimeoutError)) throw error;
				if (attempt === attempts) throw timeoutError(method, attempts);
				await sleep(100, signal);
			}
		}
		throw new Error(`Could not send ${method}`);
	}

	onEvent(method: string, handler: EventHandler): () => void {
		const handlers = this.eventHandlers.get(method) ?? new Set<EventHandler>();
		handlers.add(handler);
		this.eventHandlers.set(method, handlers);
		return () => {
			handlers.delete(handler);
			if (handlers.size === 0) this.eventHandlers.delete(method);
		};
	}

	waitForEvent(
		method: string,
		timeout = CDP_TIMEOUT_MS,
		signal?: AbortSignal,
	): CdpEventWait {
		if (signal?.aborted) {
			return {
				promise: Promise.reject(
					signal.reason ?? new Error("Operation aborted"),
				),
				cancel() {},
			};
		}
		let settled = false;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let off: (() => void) | undefined;
		let abort: (() => void) | undefined;
		const cleanup = () => {
			if (timer) clearTimeout(timer);
			off?.();
			if (abort) signal?.removeEventListener("abort", abort);
		};
		const promise = new Promise<unknown>((resolveValue, reject) => {
			off = this.onEvent(method, (params) => {
				if (settled) return;
				settled = true;
				cleanup();
				resolveValue(params);
			});
			timer = setTimeout(() => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(new Error(`Timeout waiting for event: ${method}`));
			}, timeout);
			abort = () => {
				if (settled) return;
				settled = true;
				cleanup();
				reject(signal?.reason ?? new Error("Operation aborted"));
			};
			signal?.addEventListener("abort", abort, { once: true });
		});
		return {
			promise,
			cancel() {
				if (settled) return;
				settled = true;
				cleanup();
			},
		};
	}

	onClose(handler: () => void): () => void {
		this.closeHandlers.add(handler);
		return () => this.closeHandlers.delete(handler);
	}

	close(): void {
		this.socket?.close();
		this.socket = undefined;
	}

	private sendOnce(
		method: string,
		params: CdpParams,
		sessionId?: string,
		signal?: AbortSignal,
	): Promise<unknown> {
		if (signal?.aborted) {
			return Promise.reject(signal.reason ?? new Error(`${method} aborted`));
		}
		const socket = this.socket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			return Promise.reject(new Error("CDP is not connected"));
		}
		const id = ++this.nextId;
		return new Promise((resolveValue, reject) => {
			const timer = setTimeout(() => {
				this.finishPending(id)?.reject(new CdpTimeoutError(method));
			}, CDP_TIMEOUT_MS);
			const abort = () => {
				const pending = this.pending.get(id);
				if (!pending) return;
				this.pending.delete(id);
				clearTimeout(pending.timer);
				reject(signal?.reason ?? new Error(`${method} aborted`));
			};
			this.pending.set(id, {
				resolve: resolveValue,
				reject,
				timer,
				...(signal ? { signal, abort } : {}),
			});
			signal?.addEventListener("abort", abort, { once: true });
			try {
				socket.send(
					JSON.stringify({
						id,
						method,
						params,
						...(sessionId ? { sessionId } : {}),
					}),
				);
			} catch (error) {
				this.finishPending(id);
				reject(error);
			}
		});
	}

	private handleMessage(data: unknown): void {
		let message: Record<string, unknown>;
		try {
			message = asRecord(JSON.parse(String(data)), "CDP message");
		} catch {
			return;
		}
		const id = message["id"];
		if (typeof id === "number" && this.pending.has(id)) {
			const pending = this.finishPending(id);
			if (!pending) return;
			const error = message["error"];
			if (error) {
				const record = asRecord(error, "CDP error");
				pending.reject(
					new Error(
						typeof record["message"] === "string"
							? record["message"]
							: "Unknown CDP error",
					),
				);
			} else {
				pending.resolve(message["result"]);
			}
			return;
		}
		const method = message["method"];
		if (typeof method !== "string") return;
		for (const handler of this.eventHandlers.get(method) ?? []) {
			handler(message["params"] ?? {});
		}
	}

	private finishPending(id: number): PendingCommand | undefined {
		const pending = this.pending.get(id);
		if (!pending) return undefined;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		if (pending.abort) {
			pending.signal?.removeEventListener("abort", pending.abort);
		}
		return pending;
	}

	private handleClose(): void {
		this.socket = undefined;
		for (const [id, pending] of this.pending) {
			this.finishPending(id);
			pending.reject(new Error("Chrome disconnected"));
		}
		for (const handler of this.closeHandlers) {
			try {
				handler();
			} catch (error) {
				process.stderr.write(
					`Browser close handler failed: ${errorMessage(error)}\n`,
				);
			}
		}
	}
}
