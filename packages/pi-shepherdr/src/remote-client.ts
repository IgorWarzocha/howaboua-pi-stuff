import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { HerdrConnection } from "./herdr-client.js";
import type { SshMachine } from "./machine-catalog.js";
import { createBufferedChannel } from "./remote/shepherdr-channel.mjs";
import { readPeerCommands } from "./remote/shepherdr-peer.mjs";
import {
	appendBounded,
	BRIDGE_VERSION,
	connectRemoteBridge,
} from "./remote-deployment.js";
import type { AssistantReader } from "./session-reader.js";
import type {
	HerdrEvent,
	LatestAssistant,
	PaneInfo,
	PeerChannel,
	PeerDelivery,
	PeerMessage,
	SessionView,
} from "./types.js";

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

export class RemoteHerdrClient implements HerdrConnection, AssistantReader {
	private contextHandler:
		| ((request: unknown, signal: AbortSignal) => Promise<unknown>)
		| undefined;
	private readonly incomingContext = new Map<string, AbortController>();
	private relayPath: string | undefined;
	private readonly child: ChildProcessWithoutNullStreams;
	private closed = false;
	private diagnostics = "";
	private input = "";
	private readonly onClose: (error: Error) => void;
	private readonly pending = new Map<string, PendingCall>();
	private readonly subscriptions = new Map<string, SubscriptionCallbacks>();
	private readonly channels = new Map<
		string,
		ReturnType<typeof createBufferedChannel>
	>();

	private constructor(
		child: ChildProcessWithoutNullStreams,
		onClose: (error: Error) => void,
	) {
		this.child = child;
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

	static async connect(
		config: SshMachine,
		onClose: (error: Error) => void,
	): Promise<RemoteHerdrClient> {
		const child = await connectRemoteBridge(config);
		const client = new RemoteHerdrClient(child, onClose);
		try {
			await client.ready();
			return client;
		} catch (error) {
			client.close();
			throw error;
		}
	}

	async request<T>(
		method: string,
		params: object = {},
		timeoutMs = 10_000,
	): Promise<T> {
		return (await this.call(
			{ op: "request", method, params, timeoutMs },
			timeoutMs + 1_000,
		)) as T;
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
		this.contextHandler = handler;
		const path = await this.call({ op: "context_relay", threadId, routeId });
		if (typeof path !== "string")
			throw new Error("Invalid shared context relay path");
		this.relayPath = path;
	}

	contextRelayPath(): string {
		if (!this.relayPath)
			throw new Error(
				"Shared context relay is unavailable; open /herdr → Status to retry",
			);
		return this.relayPath;
	}

	async replyExtension(
		agent: PaneInfo,
		reply: import("./types.js").ExtensionReply,
	): Promise<string> {
		const result = await this.call(
			{ op: "extension-reply", agent, reply },
			60_000,
		);
		if (typeof result !== "string")
			throw new Error(
				"Invalid extension reply receipt; inspect the target before retrying",
			);
		return result;
	}

	async commands(agent: PaneInfo): Promise<import("./types.js").PeerCommand[]> {
		const result = await this.call({ op: "commands", agent }, 26_000);
		return readPeerCommands(result);
	}

	async sendMessage(
		agent: PaneInfo,
		message: PeerMessage,
	): Promise<PeerDelivery> {
		const result = await this.call(
			{ op: "message", agent, message },
			message.text.trim() === "/quit" ? 0 : 26_000,
		);
		if (
			!result ||
			typeof result !== "object" ||
			!("command" in result) ||
			typeof result.command !== "boolean"
		)
			throw new Error(
				"Invalid peer acknowledgement; inspect the target before retrying",
			);
		return { command: result.command };
	}

	async machineIdentity(): Promise<import("./types.js").MachineIdentity> {
		const result = await this.call({ op: "identity" });
		if (
			!result ||
			typeof result !== "object" ||
			!("host" in result) ||
			typeof result.host !== "string" ||
			!("session" in result) ||
			typeof result.session !== "string"
		)
			throw new Error("Could not identify remote Herdr session");
		return { host: result.host, session: result.session };
	}

	async openFocusChannel(
		agent: PaneInfo,
		request: import("./types.js").FocusRequest,
	): Promise<PeerChannel> {
		const id = randomUUID();
		const state = createBufferedChannel(
			(message) => {
				const frame = `${JSON.stringify({ op: "channel_send", id, message })}\n`;
				if (
					this.closed ||
					this.child.stdin.writableLength + Buffer.byteLength(frame) >
						1024 * 1024
				)
					throw new Error(
						"Focus channel output is unavailable or exceeded its buffer",
					);
				this.child.stdin.write(frame);
			},
			() => {
				this.channels.delete(id);
				if (!this.closed)
					this.child.stdin.write(
						`${JSON.stringify({ op: "channel_close", id })}\n`,
					);
			},
		);
		this.channels.set(id, state);
		try {
			const result = await this.call(
				{ op: "channel_open", id, agent, request },
				60_000,
			);
			if (
				!result ||
				typeof result !== "object" ||
				!("admitted" in result) ||
				result.admitted !== true
			)
				throw new Error("Focus channel was not admitted");
			return state.channel;
		} catch (error) {
			state.fail(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	focus(
		agent: PaneInfo,
		request: import("./types.js").FocusRequest,
	): Promise<unknown> {
		return this.call({ op: "focus", agent, request }, 60_000);
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

	async latest(path?: string): Promise<LatestAssistant | undefined> {
		return (await this.view(path)).assistant;
	}

	async view(path?: string): Promise<SessionView> {
		return (await this.call({ op: "view", path })) as SessionView;
	}

	async keybindings(): Promise<Record<string, unknown>> {
		return (await this.call({ op: "keybindings" })) as Record<string, unknown>;
	}

	async directory(
		value: string | undefined,
		fallback: string,
	): Promise<string> {
		return (await this.call({ op: "directory", value, fallback })) as string;
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		this.child.kill();
		this.failPending(new Error("remote Shepherdr bridge closed"), false);
	}

	private ready(): Promise<void> {
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

	private call(
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
			if (value["type"] === "channel" && typeof value["channel"] === "string") {
				const state = this.channels.get(value["channel"]);
				if (value["closed"] === true)
					state?.fail(
						new Error(
							typeof value["error"] === "string"
								? value["error"]
								: "Focus channel disconnected",
						),
					);
				else if ("message" in value) state?.receive(value["message"]);
				else state?.fail(new Error("Invalid focus channel frame"));
				continue;
			}
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
			if (value["type"] === "context_cancel") {
				this.incomingContext.get(id)?.abort();
				continue;
			}
			if (value["type"] === "context_request") {
				const controller = new AbortController();
				this.incomingContext.set(id, controller);
				const reply = (data: object) => {
					if (this.closed || controller.signal.aborted) return;
					let frame = `${JSON.stringify({ op: "context_reply", id, ...data })}\n`;
					if (Buffer.byteLength(frame) > MAX_FRAME_BYTES)
						frame = `${JSON.stringify({ op: "context_reply", id, ok: false, error: "Shared context response is too large" })}\n`;
					this.child.stdin.write(frame);
				};
				void Promise.resolve()
					.then(() => {
						if (!this.contextHandler)
							throw new Error("Shared context controller is unavailable");
						controller.signal.throwIfAborted();
						return this.contextHandler(value["request"], controller.signal);
					})
					.then(
						(result) => reply({ ok: true, result }),
						(error: unknown) =>
							reply({
								ok: false,
								error: error instanceof Error ? error.message : String(error),
							}),
					)
					.finally(() => {
						this.incomingContext.delete(id);
					});
				continue;
			}
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
		for (const state of this.channels.values()) state.fail(error);
		this.channels.clear();
		for (const controller of this.incomingContext.values()) controller.abort();
		this.incomingContext.clear();
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
