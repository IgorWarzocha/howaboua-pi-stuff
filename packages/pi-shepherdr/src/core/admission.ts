import { randomUUID } from "node:crypto";
import type { Socket } from "node:net";
import { admissionEndpoint, connectAdmission } from "./admission-endpoint.js";

type Lane = "launch" | "bulk";
interface Waiting {
	resolve(): void;
	reject(error: Error): void;
}

/** Owns one client's queue and connection, not execution or agent identity. */
export class CoreAdmission {
	private readonly lifetime = new AbortController();
	private readonly waiting = new Map<string, Waiting>();
	private connection: Promise<Socket> | undefined;
	private socket: Socket | undefined;
	private ended: Error | undefined;
	private buffer = "";
	private readonly core: string;
	private readonly destination: string;
	constructor(core: string, destination = "local") {
		this.core = core;
		this.destination = destination;
	}

	close(): void {
		this.fail(new Error("Agent connection closed"));
	}

	private fail(error: Error): void {
		if (this.ended) return;
		this.ended = error;
		this.lifetime.abort(error);
		this.socket?.destroy();
		for (const waiter of this.waiting.values()) waiter.reject(error);
		this.waiting.clear();
	}

	private disconnected(socket: Socket): void {
		if (this.socket !== socket) return;
		this.socket = undefined;
		this.connection = undefined;
		this.buffer = "";
		socket.destroy();
		// Only callers not yet admitted fail. Accepted work keeps its original
		// execution/cleanup owner and is never replayed after broker loss.
		for (const waiter of this.waiting.values())
			waiter.reject(
				new Error(
					"Agent connection lost before starting; try the operation again",
				),
			);
	}

	private async open(): Promise<Socket> {
		const path = await admissionEndpoint(this.core, this.destination);
		const startup = AbortSignal.any([
			this.lifetime.signal,
			AbortSignal.timeout(5000),
		]);
		const socket = await connectAdmission(path, startup);
		if (this.ended) {
			socket.destroy();
			throw this.ended;
		}
		this.socket = socket;
		socket.setEncoding("utf8");
		socket.on("error", () => this.disconnected(socket));
		socket.on("close", () => this.disconnected(socket));
		socket.on("data", (chunk: string) => {
			try {
				this.buffer += chunk;
				for (;;) {
					const end = this.buffer.indexOf("\n");
					if (
						Buffer.byteLength(
							end < 0 ? this.buffer : this.buffer.slice(0, end),
						) > 8192
					)
						throw new Error("Invalid agent connection response");
					if (end < 0) break;
					const value: unknown = JSON.parse(this.buffer.slice(0, end));
					this.buffer = this.buffer.slice(end + 1);
					if (
						!value ||
						typeof value !== "object" ||
						!("id" in value) ||
						typeof value.id !== "string" ||
						!("state" in value)
					)
						throw new Error("Invalid agent connection response");
					const waiter = this.waiting.get(value.id);
					if (value.state === "granted") waiter?.resolve();
					else if (
						value.state === "error" &&
						"message" in value &&
						typeof value.message === "string"
					)
						waiter?.reject(
							new Error(
								"Too many simultaneous agent operations; finish existing calls before starting more",
							),
						);
					else throw new Error("Invalid agent connection response");
				}
			} catch (error) {
				this.fail(error instanceof Error ? error : new Error(String(error)));
			}
		});
		return socket;
	}

	/** Deadline is for admission only. Execution owns its existing cancellation/timeout. */
	async run<T>(
		lane: Lane,
		execute: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		signal?.throwIfAborted();
		if (this.ended) throw this.ended;
		if (this.waiting.size >= 64)
			throw new Error(
				"Too many simultaneous agent operations; finish existing calls before starting more",
			);
		const id = randomUUID();
		const admission = AbortSignal.any([
			this.lifetime.signal,
			AbortSignal.timeout(90_000),
			...(signal ? [signal] : []),
		]);
		let socket: Socket | undefined;
		let resolve!: () => void;
		let reject!: (error: Error) => void;
		const granted = new Promise<void>((yes, no) => {
			resolve = yes;
			reject = no;
		});
		// Register before connection startup: cancellation cannot submit queued work.
		this.waiting.set(id, { resolve, reject });
		const abort = () =>
			reject(
				new Error(
					admission.reason?.name === "TimeoutError"
						? "Agent operation could not start before its deadline; try again when current work finishes"
						: "Agent operation cancelled before starting",
					{ cause: admission.reason },
				),
			);
		admission.addEventListener("abort", abort, { once: true });
		if (admission.aborted) abort();
		const connecting = (this.connection ??= this.open());
		void connecting.then(
			(connection) => {
				socket = connection;
				if (!admission.aborted && this.waiting.has(id))
					socket.write(`${JSON.stringify({ op: "acquire", id, lane })}\n`);
			},
			(error: unknown) => {
				if (this.connection !== connecting) return;
				this.connection = undefined;
				for (const waiter of this.waiting.values())
					waiter.reject(
						new Error(
							"Agent operations could not start; check local runtime permissions and try again",
							{ cause: error },
						),
					);
			},
		);
		try {
			await granted;
			admission.throwIfAborted();
			admission.removeEventListener("abort", abort);
			// Broker failure never retries accepted work. Existing operation owns cleanup.
			return await execute();
		} finally {
			admission.removeEventListener("abort", abort);
			this.waiting.delete(id);
			if (socket && !socket.destroyed)
				socket.write(`${JSON.stringify({ op: "release", id })}\n`);
		}
	}
}
