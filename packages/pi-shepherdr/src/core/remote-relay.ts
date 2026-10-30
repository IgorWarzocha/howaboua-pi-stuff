import { createHash, randomBytes } from "node:crypto";
import { CoreClient } from "./client.js";
import { object } from "./protocol.js";
import { type CoreMachine, remoteExec } from "./remote-exec.js";

// Fleet closes synchronously and can immediately construct a replacement owner.
// Retain only live/closing routes, including starts not yet acknowledged by Core.
const routes = new Map<string, CoreContextRelay>();
// Match context-relay.mjs: sixfold Notes escaping plus envelope headroom.
const RELAY_PAYLOAD_BYTES = 6_250_000;

/** Owns the reverse route, its bounded polling and all host-side handlers. */
export class CoreContextRelay {
	private readonly client: CoreClient;
	private readonly machine: CoreMachine;
	private readonly token = randomBytes(32).toString("hex");
	private readonly controller = new AbortController();
	private readonly incoming = new Map<string, AbortController>();
	private pathValue: string | undefined;
	private failed: Error | undefined;
	private closed = false;
	private closing: Promise<void> | undefined;
	private starting: Promise<void> | undefined;
	private route: string | undefined;
	private readonly socket: string;
	private onFailure: ((error: Error) => void) | undefined;
	constructor(socket: string, machine: CoreMachine) {
		this.socket = socket;
		this.client = new CoreClient(socket);
		this.machine = machine;
	}
	start(
		threadId: string,
		handle: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		onFailure: (error: Error) => void,
	): Promise<void> {
		if (this.starting || this.closed)
			return Promise.reject(
				new Error("Shared context relay is already started or closed"),
			);
		this.route = JSON.stringify([this.socket, this.machine.id, threadId]);
		const previous = routes.get(this.route);
		routes.set(this.route, this);
		this.starting = this.open(threadId, handle, onFailure, previous);
		return this.starting;
	}
	private async open(
		threadId: string,
		handle: (request: unknown, signal: AbortSignal) => Promise<unknown>,
		onFailure: (error: Error) => void,
		previous: CoreContextRelay | undefined,
	): Promise<void> {
		await previous?.close();
		this.controller.signal.throwIfAborted();
		this.onFailure = onFailure;
		const path = await remoteExec(
			this.client,
			this.machine,
			{
				op: "relay-start",
				threadId,
				routeId: createHash("sha256")
					.update(this.machine.id)
					.digest("hex")
					.slice(0, 32),
				relayToken: this.token,
			},
			// Accepted machine.exec is not cancelled by closing its local socket.
			// Finish this bounded start so close can remove its actual daemon.
		);
		if (typeof path !== "string")
			throw new Error("Invalid shared context relay path");
		this.pathValue = path;
		if (this.closed) return;
		void this.poll(handle).catch((error: unknown) => {
			this.fail(error);
		});
	}
	path(): string {
		if (this.failed)
			throw new Error(
				`Shared context relay disconnected: ${this.failed.message}. Open /herdr → Status to retry sharing`,
			);
		if (!this.pathValue || this.controller.signal.aborted)
			throw new Error(
				"Shared context relay is unavailable; open /herdr → Status to retry sharing",
			);
		return this.pathValue;
	}
	private call(request: object, signal?: AbortSignal) {
		return remoteExec(
			this.client,
			this.machine,
			{
				op: "context",
				path: this.pathValue,
				request: { ...request, relayToken: this.token },
			},
			{ timeoutMs: 25_000, ...(signal ? { signal } : {}) },
		);
	}
	private async poll(
		handle: (request: unknown, signal: AbortSignal) => Promise<unknown>,
	) {
		while (!this.controller.signal.aborted) {
			const batch = object(
				await this.call({ action: "poll" }, this.controller.signal),
			);
			if (!Array.isArray(batch["requests"]) || !Array.isArray(batch["active"]))
				throw new Error("Invalid shared context relay batch");
			const active = batch["active"];
			for (const [id, controller] of this.incoming)
				if (!active.includes(id)) controller.abort();
			for (const value of batch["requests"]) {
				const entry = object(value);
				const id = entry["id"];
				if (typeof id !== "string" || this.incoming.has(id))
					throw new Error("Invalid shared context relay request");
				const controller = new AbortController();
				this.incoming.set(id, controller);
				void this.respond(id, entry["request"], controller, handle)
					.catch((error: unknown) => {
						this.fail(error);
					})
					.finally(() => this.incoming.delete(id));
			}
		}
		if (this.failed) throw this.failed;
	}
	private async respond(
		id: string,
		request: unknown,
		controller: AbortController,
		handle: (request: unknown, signal: AbortSignal) => Promise<unknown>,
	) {
		let reply: object;
		try {
			controller.signal.throwIfAborted();
			const result = await handle(request, controller.signal);
			reply = { ok: true, result };
		} catch (error) {
			reply = {
				ok: false,
				error: error instanceof Error ? error.message : String(error),
			};
		}
		if (controller.signal.aborted || this.controller.signal.aborted) return;
		if (Buffer.byteLength(JSON.stringify(reply)) > RELAY_PAYLOAD_BYTES)
			reply = {
				ok: false,
				error: "Shared context response is too large; narrow the request",
			};
		await this.call({ action: "reply", id, ...reply }, this.controller.signal);
	}
	private fail(error: unknown): void {
		if (this.closed) return;
		this.failed = error instanceof Error ? error : new Error(String(error));
		void this.close();
		this.onFailure?.(this.failed);
	}
	close(): Promise<void> {
		if (this.closing) return this.closing;
		this.closed = true;
		this.controller.abort();
		for (const controller of this.incoming.values()) controller.abort();
		this.incoming.clear();
		// A separate bounded connection can close the accepted remote daemon.
		// If the machine disappeared, its 30-second lease performs cleanup.
		this.closing = (async () => {
			await this.starting?.catch(() => {});
			if (this.pathValue)
				await remoteExec(
					this.client,
					this.machine,
					{ op: "relay-close", path: this.pathValue, relayToken: this.token },
					{ timeoutMs: 10_000 },
				);
		})()
			.catch(async () => {
				// A failed close cannot prove removal. Keep replacement starts
				// behind the daemon's 30-second no-poll lease, not a stale owner.
				await new Promise((resolve) => setTimeout(resolve, 31_000));
			})
			.finally(() => {
				this.client.close();
				if (this.route && routes.get(this.route) === this)
					routes.delete(this.route);
			});
		return this.closing;
	}
}
