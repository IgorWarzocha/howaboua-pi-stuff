import { createHash, randomUUID } from "node:crypto";
import { ContextRelay } from "../remote/context-relay.js";
import type {
	CoreRequestOptions,
	CoreSubscribeOptions,
	CoreSubscription,
} from "./client.js";
import type { CoreMachine } from "./machines.js";
import {
	type CoreNotification,
	type CoreObject,
	notification,
	object,
	snapshot,
} from "./protocol.js";
import { openRemoteHelper, type RemoteHelper } from "./remote-helper.js";

interface Pending {
	resolve(value: unknown): void;
	reject(error: Error): void;
	timer: NodeJS.Timeout | undefined;
	cleanup(): void;
}
interface Subscription {
	receive(message: CoreObject): void;
	close(error?: Error): void;
}
const relayOwners = new Map<string, CoreRemoteTransport>();

/** One owner for helper lifetime, requests, subscriptions and reverse context calls. */
export class CoreRemoteTransport {
	private readonly lifetime = new AbortController();
	private readonly starting: Promise<RemoteHelper>;
	private helper: RemoteHelper | undefined;
	private readonly pending = new Map<string, Pending>();
	private readonly subscriptions = new Map<string, Subscription>();
	private readonly relay: ContextRelay;
	private ended: Error | undefined;
	private closing: Promise<void> | undefined;
	private route: string | undefined;
	private relayFailure: ((error: Error) => void) | undefined;
	private readonly socketPath: string;
	private readonly machine: CoreMachine;
	constructor(socketPath: string, machine: CoreMachine) {
		this.socketPath = socketPath;
		this.machine = machine;
		this.relay = new ContextRelay(
			(message) => this.send(message),
			() => !!this.ended,
			8 * 1024 * 1024,
			(error) => {
				void this.close(error);
			},
		);
		this.starting = openRemoteHelper(
			socketPath,
			machine,
			(message) => this.receive(message),
			(error) => {
				void this.close(error);
			},
			this.lifetime.signal,
		);
		void this.starting.then(
			(helper) => {
				this.helper = helper;
			},
			(error: unknown) => {
				void this.close(
					error instanceof Error ? error : new Error(String(error)),
				);
			},
		);
	}
	async call(
		message: CoreObject,
		options: CoreRequestOptions = {},
	): Promise<unknown> {
		options.signal?.throwIfAborted();
		if (this.ended) throw this.ended;
		const id = typeof message["id"] === "string" ? message["id"] : randomUUID();
		return new Promise((resolve, reject) => {
			const cancel = (reason: string) => {
				this.finish(
					id,
					new Error(
						`Remote request ${reason}; it may already have completed. Inspect the target before retrying`,
					),
				);
				try {
					if (!this.ended && this.helper)
						this.send({ op: "context_cancel", id });
				} catch (error) {
					void this.close(
						error instanceof Error ? error : new Error(String(error)),
					);
				}
			};
			const abort = () => cancel("cancelled");
			const timeout = options.timeoutMs ?? 30_000;
			const timer =
				timeout === 0
					? undefined
					: setTimeout(() => cancel("timed out"), timeout);
			this.pending.set(id, {
				resolve,
				reject,
				timer,
				cleanup: () => options.signal?.removeEventListener("abort", abort),
			});
			options.signal?.addEventListener("abort", abort, { once: true });
			void this.starting
				.then(() => {
					if (this.pending.has(id)) this.send({ ...message, id });
				})
				.catch((error: unknown) =>
					this.finish(
						id,
						error instanceof Error ? error : new Error(String(error)),
					),
				);
		});
	}
	private send(message: CoreObject): void {
		if (this.ended || !this.helper)
			throw this.ended ?? new Error("Remote connection is not ready");
		this.helper.send(message);
	}
	private finish(id: string, error?: Error, result?: unknown): void {
		const pending = this.pending.get(id);
		if (!pending) return;
		this.pending.delete(id);
		clearTimeout(pending.timer);
		pending.cleanup();
		if (error) pending.reject(error);
		else pending.resolve(result);
	}
	private receive(message: CoreObject): void {
		if (this.ended) return;
		if (typeof message["subscription"] === "string") {
			this.subscriptions.get(message["subscription"])?.receive(message);
			return;
		}
		const id = message["id"];
		if (typeof id !== "string")
			throw new Error("Remote response has no request identity");
		if (this.relay.consume(id, message)) return;
		if (message["ok"] === true) this.finish(id, undefined, message["result"]);
		else {
			const detail = object(message["error"]);
			const error = new Error(
				typeof detail["message"] === "string"
					? detail["message"]
					: "Remote request failed",
			);
			for (const key of ["code", "kind", "hint"])
				if (typeof detail[key] === "string")
					Object.assign(error, { [key]: detail[key] });
			this.finish(id, error);
		}
	}
	async subscribe(
		filter: CoreObject,
		onEvent: (event: CoreNotification) => void,
		options: CoreSubscribeOptions = {},
	): Promise<CoreSubscription> {
		let resolveClosed: (error?: Error) => void = () => {};
		const closed = new Promise<Error | undefined>((resolve) => {
			resolveClosed = resolve;
		});
		const close = await this.listen(
			{ op: "subscribe", filter },
			(message) => {
				const event = object(message["event"]);
				if (
					!["snapshot", "missed", "event", "heartbeat"].includes(
						String(event["method"]),
					)
				)
					throw new Error("Invalid remote event");
				onEvent(
					event["method"] === "snapshot"
						? { method: "snapshot", ...snapshot(event) }
						: notification({
								jsonrpc: "2.0",
								method: event["method"],
								params: event["method"] === "event" ? event["event"] : event,
							}),
				);
			},
			resolveClosed,
			options,
		);
		return { closed, close };
	}
	async watch(
		paths: string[],
		onChange: (path: string) => void,
		onError: (error: Error) => void,
		signal: AbortSignal,
	): Promise<() => void> {
		return this.listen(
			{ op: "watch", paths },
			(message) => {
				const path = message["path"];
				if (typeof path !== "string" || !paths.includes(path))
					throw new Error("Invalid remote session change");
				onChange(path);
			},
			(error) => {
				if (error && !signal.aborted) onError(error);
			},
			{ signal },
		);
	}
	private async listen(
		message: CoreObject,
		receive: Subscription["receive"],
		onClose: Subscription["close"],
		options: CoreRequestOptions,
	): Promise<() => void> {
		options.signal?.throwIfAborted();
		const id = randomUUID();
		const close = (error?: Error) => {
			if (!this.subscriptions.delete(id)) return;
			options.signal?.removeEventListener("abort", abort);
			onClose(error);
			if (!this.ended)
				void this.call({ op: "unsubscribe", subscription: id }).catch(() => {});
		};
		const abort = () => close();
		this.subscriptions.set(id, { receive, close });
		options.signal?.addEventListener("abort", abort, { once: true });
		try {
			await this.call({ ...message, id }, options);
			options.signal?.throwIfAborted();
			return () => close();
		} catch (error) {
			close(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}
	async startContextRelay(
		threadId: string,
		handler: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		onFailure: (error: Error) => void,
	): Promise<void> {
		const route = JSON.stringify([this.socketPath, this.machine.id, threadId]);
		const previous = relayOwners.get(route);
		if (previous && previous !== this) await previous.close();
		if (this.ended) throw this.ended;
		this.route = route;
		this.relayFailure = onFailure;
		relayOwners.set(route, this);
		await this.relay.start(
			threadId,
			createHash("sha256").update(this.machine.id).digest("hex").slice(0, 32),
			handler,
			(message) => this.call(message),
		);
	}
	contextRelayPath(): string {
		if (this.ended) throw this.ended;
		return this.relay.path();
	}
	close(error?: Error): Promise<void> {
		if (this.closing) return this.closing;
		if (this.ended) return Promise.resolve();
		this.ended = error ?? new Error("Remote connection closed");
		// Abort startup promptly; its owner still awaits any accepted terminal.run
		// and cleans that terminal before the replacement route may start.
		if (!this.helper) this.lifetime.abort();
		this.relay.abortAll();
		for (const id of this.pending.keys()) this.finish(id, this.ended);
		for (const subscription of [...this.subscriptions.values()])
			subscription.close(this.ended);
		this.closing = this.starting
			.then(
				(helper) => helper.close(),
				() => {},
			)
			.finally(() => {
				this.lifetime.abort();
				if (this.route && relayOwners.get(this.route) === this)
					relayOwners.delete(this.route);
			});
		if (error) this.relayFailure?.(error);
		return this.closing;
	}
}
