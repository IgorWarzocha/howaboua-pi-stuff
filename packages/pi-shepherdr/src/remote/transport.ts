import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { HerdrEvent, PaneInfo, PeerChannel } from "../types.js";
import { ContextRelay } from "./context-relay.js";
import { appendBounded, BRIDGE_VERSION } from "./deployment.js";
import { FocusChannels } from "./focus-channels.js";

const MAX_FRAME_BYTES = 8 * 1024 * 1024;
const READY_TIMEOUT_MS = 15_000;

interface PendingCall {
	reject: (error: Error) => void;
	resolve: (value: unknown) => void;
	timer: NodeJS.Timeout | undefined;
	cleanup?: () => void;
}

interface SubscriptionCallbacks {
	onDisconnect: (error?: Error) => void;
	onEvent: (event: HerdrEvent) => void;
}

interface BridgeError {
	code?: string;
	herdrResponse?: boolean;
	message: string;
}

/** Sole authority for framed calls, streams, duplex channels, context relay and teardown. */
export class RemoteTransport {
	private readonly contextRelay: ContextRelay;
	private readonly child: ChildProcessWithoutNullStreams;
	private closed = false;
	private diagnostics = "";
	private input = "";
	private readonly onClose: (error: Error) => void;
	private readonly pending = new Map<string, PendingCall>();
	private readonly subscriptions = new Map<string, SubscriptionCallbacks>();
	private readonly focusChannels: FocusChannels;

	protected constructor(
		child: ChildProcessWithoutNullStreams,
		onClose: (error: Error) => void,
	) {
		this.child = child;
		this.contextRelay = new ContextRelay(
			child,
			() => this.closed,
			MAX_FRAME_BYTES,
		);
		this.focusChannels = new FocusChannels(child, () => this.closed);
		this.onClose = onClose;
		child.stdout.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => this.consume(chunk));
		child.stderr.on("data", (chunk: Buffer) => {
			this.diagnostics = appendBounded(this.diagnostics, chunk);
		});
		child.stdin.on("error", (error) => this.disconnected(error));
		child.on("error", (error) => this.disconnected(error));
		child.on("exit", (code) => {
			this.disconnected(
				new Error(
					this.diagnostics.trim() ||
						`remote Shepherdr bridge exited ${code ?? "without status"}`,
				),
			);
		});
	}

	async requestContext(
		path: string,
		request: unknown,
		signal?: AbortSignal,
	): Promise<unknown> {
		signal?.throwIfAborted();
		return this.call({ op: "context", path, request }, 36_000, signal);
	}

	async startContextRelay(
		threadId: string,
		routeId: string,
		handler: (request: unknown, signal: AbortSignal) => Promise<unknown>,
	): Promise<void> {
		return this.contextRelay.start(threadId, routeId, handler, (message) =>
			this.call(message),
		);
	}
	contextRelayPath(): string {
		return this.contextRelay.path();
	}

	async openFocusChannel(
		agent: PaneInfo,
		request: import("../types.js").FocusRequest,
	): Promise<PeerChannel> {
		return this.focusChannels.open(agent, request, (message, timeoutMs) =>
			this.call(message, timeoutMs),
		);
	}

	async subscribe(
		subscriptions: object[],
		onEvent: (event: HerdrEvent) => void,
		onDisconnect: (error?: Error) => void,
		signal?: AbortSignal,
	): Promise<() => void> {
		return this.subscribeTo(
			{ op: "subscribe", subscriptions },
			onEvent,
			onDisconnect,
			signal,
		);
	}

	async watch(
		paths: string[],
		onChange: (path: string) => void,
		onError: (error: Error) => void,
		signal: AbortSignal,
	): Promise<() => void> {
		return this.subscribeTo(
			{ op: "session_subscribe", paths },
			(event) => {
				if (typeof event.data["path"] === "string")
					onChange(event.data["path"]);
			},
			(error) => onError(error ?? new Error("Session activity stream closed")),
			signal,
		);
	}

	private async subscribeTo(
		request: Record<string, unknown>,
		onEvent: (event: HerdrEvent) => void,
		onDisconnect: (error?: Error) => void,
		signal?: AbortSignal,
	): Promise<() => void> {
		signal?.throwIfAborted();
		const id = randomUUID();
		this.subscriptions.set(id, { onEvent, onDisconnect });
		const unsubscribe = () => {
			signal?.removeEventListener("abort", unsubscribe);
			if (!this.subscriptions.delete(id) || this.closed) return;
			void this.call({ op: "unsubscribe", subscription: id }).catch(
				() => undefined,
			);
		};
		try {
			const ready = this.call({ ...request, id }, 11_000);
			signal?.addEventListener("abort", unsubscribe, { once: true });
			if (signal?.aborted) unsubscribe();
			await ready;
			signal?.throwIfAborted();
		} catch (error) {
			unsubscribe();
			throw error;
		}
		return unsubscribe;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.child.kill();
		this.failPending(new Error("remote Shepherdr bridge closed"), false);
	}

	protected ready(): Promise<void> {
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.close();
				reject(new Error("remote Shepherdr bridge did not become ready"));
			}, READY_TIMEOUT_MS);
			timer.unref();
			this.pending.set("ready", {
				timer,
				resolve: (value) => {
					const ready = value as { version?: unknown };
					if (ready.version !== BRIDGE_VERSION) {
						reject(new Error("remote Shepherdr bridge version mismatch"));
						return;
					}
					resolve();
				},
				reject,
			});
		});
	}

	protected call(
		message: Record<string, unknown>,
		timeoutMs = 10_000,
		signal?: AbortSignal,
	): Promise<unknown> {
		signal?.throwIfAborted();
		if (this.closed)
			return Promise.reject(
				new Error("remote Shepherdr bridge is unavailable"),
			);
		const id = typeof message["id"] === "string" ? message["id"] : randomUUID();
		return new Promise((resolve, reject) => {
			const timer =
				timeoutMs === 0
					? undefined
					: setTimeout(() => {
							const error = new Error(
								`remote Shepherdr ${String(message["op"])} timed out`,
							);
							if (message["op"] === "context_relay")
								this.rejectPending(id, error);
							else this.disconnected(error);
						}, timeoutMs);
			timer?.unref();
			const abort = () => {
				if (!this.pending.has(id)) return;
				this.rejectPending(
					id,
					new Error(
						"Shared context request cancelled; a write may have completed. Reread the note before retrying",
					),
				);
				this.child.stdin.write(
					`${JSON.stringify({ op: "context_cancel", id })}\n`,
				);
			};
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				cleanup: () => signal?.removeEventListener("abort", abort),
			});
			signal?.addEventListener("abort", abort, { once: true });
			this.child.stdin.write(
				`${JSON.stringify({ ...message, id })}\n`,
				(error) => {
					if (!error) return;
					this.disconnected(error);
				},
			);
		});
	}

	private consume(chunk: string): void {
		this.input += chunk;
		if (Buffer.byteLength(this.input) > MAX_FRAME_BYTES) {
			this.disconnected(
				new Error("remote Shepherdr bridge frame is too large"),
			);
			return;
		}
		for (;;) {
			const newline = this.input.indexOf("\n");
			if (newline < 0) break;
			const line = this.input.slice(0, newline);
			this.input = this.input.slice(newline + 1);
			if (!line) continue;
			let value: Record<string, unknown>;
			try {
				value = JSON.parse(line) as Record<string, unknown>;
			} catch (error) {
				this.disconnected(
					new Error(
						`remote Shepherdr bridge returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
					),
				);
				return;
			}
			if (value["type"] === "ready") {
				this.resolvePending("ready", value);
				continue;
			}
			if (this.focusChannels.consume(value)) continue;
			const subscription = value["subscription"];
			if (typeof subscription === "string") {
				const callbacks = this.subscriptions.get(subscription);
				const event = value["event"];
				if (callbacks && event && typeof event === "object") {
					try {
						callbacks.onEvent(event as HerdrEvent);
					} catch (error) {
						this.disconnected(
							new Error(
								`Shepherdr event handling failed: ${error instanceof Error ? error.message : String(error)}`,
								{ cause: error },
							),
						);
						return;
					}
				}
				continue;
			}
			const id = value["id"];
			if (typeof id !== "string") continue;
			if (this.contextRelay.consume(id, value)) continue;
			if (value["ok"] === true) this.resolvePending(id, value["result"]);
			else {
				const detail = value["error"] as BridgeError | undefined;
				const error = new Error(
					detail?.message ?? "remote Shepherdr bridge request failed",
				) as Error & {
					code?: string;
					herdrResponse?: true;
				};
				if (detail?.code) error.code = detail.code;
				if (detail?.herdrResponse) error.herdrResponse = true;
				this.rejectPending(id, error);
			}
		}
	}

	private resolvePending(id: string, value: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.cleanup?.();
		pending.resolve(value);
	}

	private rejectPending(id: string, error: Error): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.cleanup?.();
		pending.reject(error);
	}

	private disconnected(error: Error): void {
		if (this.closed) return;
		if ("code" in error && error.code === "EPIPE")
			error = new Error("Connection to the remote machine closed", {
				cause: error,
			});
		this.closed = true;
		this.child.kill();
		this.failPending(error, true);
	}

	private failPending(error: Error, notify: boolean): void {
		this.focusChannels.failAll(error);
		this.contextRelay.abortAll();
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.cleanup?.();
			pending.reject(error);
		}
		this.pending.clear();
		let callbackFailure: unknown;
		for (const callbacks of this.subscriptions.values()) {
			try {
				callbacks.onDisconnect(error);
			} catch (failure) {
				callbackFailure ??= failure;
			}
		}
		this.subscriptions.clear();
		if (notify) {
			this.onClose(
				callbackFailure === undefined
					? error
					: new Error(
							`${error.message}; disconnect handler failed: ${callbackFailure instanceof Error ? callbackFailure.message : String(callbackFailure)}`,
							{ cause: callbackFailure },
						),
			);
		}
	}
}
