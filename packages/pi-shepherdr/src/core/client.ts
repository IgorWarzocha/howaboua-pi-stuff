import { Socket } from "node:net";
import {
	type CoreNotification,
	type CoreObject,
	notification,
	object,
	response,
	snapshot,
} from "./protocol.js";

export interface CoreRequestOptions {
	signal?: AbortSignal;
	/** Includes connection time. Default: 30 seconds. */
	timeoutMs?: number;
}

export interface CoreEventFilter {
	terminal?: string;
	children_of?: string;
	labels?: Record<string, string>;
}

export interface CoreSubscribeOptions extends CoreRequestOptions {
	/** Maximum silence after the snapshot. Default: 45 seconds (Core heartbeats every 15). */
	idleTimeoutMs?: number;
}

export interface CoreSubscription {
	/** Resolves once: undefined for explicit close, otherwise the failure/abort reason. */
	closed: Promise<Error | undefined>;
	close(): void;
}

function timeout(value: number): number {
	if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
		throw new Error(
			"Core timeout must be a positive integer below 2147483648 ms",
		);
	}
	return value;
}

function failure(value: unknown): Error {
	return value instanceof Error ? value : new Error(String(value));
}

function timedOut(): Error {
	const error = new Error("Core connection timed out");
	error.name = "TimeoutError";
	return error;
}

/** Plain NDJSON only. Core dedicates a connection to events after subscribing. */
class PlainConnection {
	private readonly socket = new Socket();
	private ended = false;
	private buffer = "";
	private timer: NodeJS.Timeout | undefined;
	private readonly options: CoreRequestOptions;
	private readonly onMessage: (message: CoreObject) => void;
	private readonly onClose: (error: Error | undefined) => void;
	private readonly abort = () => {
		const error = new Error("Core connection cancelled", {
			cause: this.options.signal?.reason,
		});
		error.name = "AbortError";
		this.close(error);
	};

	constructor(
		options: CoreRequestOptions,
		onMessage: (message: CoreObject) => void,
		onClose: (error: Error | undefined) => void,
	) {
		this.options = options;
		this.onMessage = onMessage;
		this.onClose = onClose;
	}

	start(socketPath: string, payload: string): void {
		this.socket.setEncoding("utf8");
		this.socket.on("data", (chunk: string) => this.receive(chunk));
		this.socket.on("error", (error) => this.close(error));
		this.socket.on("close", () =>
			this.close(new Error("Core connection closed")),
		);
		this.options.signal?.addEventListener("abort", this.abort, { once: true });
		if (this.options.signal?.aborted) return this.abort();
		this.setTimeout(this.options.timeoutMs ?? 30_000);
		try {
			this.socket.connect(socketPath, () => this.socket.write(payload));
		} catch (error) {
			this.close(failure(error));
		}
	}

	setTimeout(ms: number): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => this.close(timedOut()), ms);
	}

	close(error?: Error): void {
		if (this.ended) return;
		this.ended = true;
		if (this.timer) clearTimeout(this.timer);
		this.options.signal?.removeEventListener("abort", this.abort);
		this.socket.destroy();
		this.buffer = "";
		this.onClose(error);
	}

	private receive(chunk: string): void {
		if (this.ended) return;
		this.buffer += chunk;
		try {
			let end = this.buffer.indexOf("\n");
			while (end !== -1 && !this.ended) {
				const line = this.buffer.slice(0, end);
				this.buffer = this.buffer.slice(end + 1);
				this.checkSize(line);
				if (line.trim()) this.onMessage(object(JSON.parse(line)));
				end = this.buffer.indexOf("\n");
			}
			this.checkSize(this.buffer);
		} catch (error) {
			this.close(failure(error));
		}
	}

	private checkSize(line: string): void {
		// Released file/exec methods can return up to 8 MiB, base64 encoded.
		if (Buffer.byteLength(line) > 32 * 1024 * 1024) {
			throw new Error("Core JSON-RPC message exceeds 32 MiB");
		}
	}
}

/**
 * Connects only to the supplied local endpoint; never starts or reconnects Core.
 * Cancellation/timeouts close the socket, not a rollback of already accepted work.
 */
export class CoreClient {
	private readonly connections = new Set<PlainConnection>();
	private ended = false;
	private readonly socketPath: string;

	constructor(socketPath: string) {
		if (!socketPath) throw new Error("A Core socket path is required");
		this.socketPath = socketPath;
	}

	/** Result payloads stay unknown: callers validate their chosen released API method. */
	request(
		method: string,
		params: CoreObject = {},
		options: CoreRequestOptions = {},
	): Promise<unknown> {
		if (method === "events.subscribe") {
			return Promise.reject(new Error("Use CoreClient.subscribe for events"));
		}
		return new Promise((resolve, reject) => {
			const connection = this.open(
				method,
				params,
				options,
				(message) => {
					const result = response(message);
					resolve(result);
					connection.close();
				},
				(error) => reject(error ?? new Error("Core request closed")),
			);
		});
	}

	/**
	 * The callback receives the initial snapshot before live events. Replace terminal
	 * state on snapshot/missed; missed also requires refetching any watched documents.
	 * Old events at/below a snapshot are discarded. Sequence gaps are normal with
	 * filters, not proof of loss. No replay or continuity is promised across reconnects.
	 * Callbacks run synchronously; a thrown error closes the subscription.
	 */
	subscribe(
		filter: CoreEventFilter,
		onNotification: (message: CoreNotification) => void,
		options: CoreSubscribeOptions = {},
	): Promise<CoreSubscription> {
		return new Promise((resolve, reject) => {
			const idleTimeout = timeout(options.idleTimeoutMs ?? 45_000);
			let initial = true;
			let floor = 0;
			let resolveClosed: (error: Error | undefined) => void = () => {};
			const closed = new Promise<Error | undefined>((done) => {
				resolveClosed = done;
			});
			const connection = this.open(
				"events.subscribe",
				{ ...filter },
				options,
				(message) => {
					connection.setTimeout(idleTimeout);
					if (initial) {
						const result = object(response(message));
						if (result["channel"] != null)
							throw new Error("Expected a plain Core subscription");
						const state = snapshot(result);
						floor = state.seq;
						initial = false;
						onNotification({ method: "snapshot", ...state });
						resolve({ closed, close: () => connection.close() });
						return;
					}
					const update = notification(message);
					if (update.method === "missed") floor = update.seq;
					if (update.method === "event" && update.event.seq <= floor) return;
					onNotification(update);
				},
				(error) => {
					reject(error ?? new Error("Core subscription closed before ready"));
					resolveClosed(error);
				},
			);
		});
	}

	close(): void {
		this.ended = true;
		for (const connection of this.connections) connection.close();
	}

	private open(
		method: string,
		params: CoreObject,
		options: CoreRequestOptions,
		onMessage: (message: CoreObject) => void,
		onClose: (error: Error | undefined) => void,
	): PlainConnection {
		if (this.ended) throw new Error("Core client is closed");
		timeout(options.timeoutMs ?? 30_000);
		const payload = `${JSON.stringify({ jsonrpc: "2.0", id: 1, method, params })}\n`;
		const connection = new PlainConnection(options, onMessage, (error) => {
			this.connections.delete(connection);
			onClose(error);
		});
		this.connections.add(connection);
		connection.start(this.socketPath, payload);
		return connection;
	}
}
