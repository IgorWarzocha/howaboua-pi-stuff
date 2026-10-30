import {
	CoreClient,
	type CoreEventFilter,
	type CoreRequestOptions,
	type CoreSubscribeOptions,
} from "./client.js";
import { type CoreNotification, type CoreObject, object } from "./protocol.js";
import { type CoreMachine, remoteExec } from "./remote-exec.js";

/** Terminal addresses are local within this machine-scoped fleet runtime. */
export class RemoteCoreEndpoint {
	readonly host: CoreClient;
	readonly machine: CoreMachine;
	constructor(socketPath: string, machine: CoreMachine) {
		this.host = new CoreClient(socketPath);
		this.machine = machine;
	}
	close(): void {
		this.host.close();
	}
	private local(value: unknown): CoreObject {
		const terminal = object(value);
		const prefix = `${this.machine.name}/`;
		if (
			typeof terminal["address"] !== "string" ||
			!terminal["address"].startsWith(prefix)
		)
			throw new Error("Remote Core returned another machine's terminal");
		return { ...terminal, address: terminal["address"].slice(prefix.length) };
	}
	async request(
		method: string,
		params: CoreObject = {},
		options: CoreRequestOptions = {},
	): Promise<unknown> {
		if (method === "hello") {
			const identity = object(
				await remoteExec(this.host, this.machine, { op: "identity" }, options),
			);
			return { core: { id: identity["session"], name: identity["host"] } };
		}
		if (method === "terminal.list") {
			const result = object(
				await this.host.request("machine.list", {}, options),
			);
			const machines = result["machines"];
			const machine = Array.isArray(machines)
				? machines.map(object).find((entry) => entry["id"] === this.machine.id)
				: undefined;
			if (
				!machine ||
				machine["state"] !== "connected" ||
				machine["name"] !== this.machine.name
			)
				throw new Error(
					"Remote Core is disconnected or renamed; refresh machines and reconnect before continuing",
				);
			// Aggregate terminal.list silently omits machines slower than 3 seconds.
			// Query the selected Core itself so an incomplete list cannot drop watches.
			return remoteExec(this.host, this.machine, { op: "list" }, options);
		}
		if (method === "terminal.run")
			return this.local(
				await this.host.request(
					method,
					{
						...params,
						on: this.machine.id,
						no_parent: true,
						parent: undefined,
						env: {},
					},
					options,
				),
			);
		if (
			typeof params["terminal"] !== "string" ||
			!/^t[0-9a-z]+$/.test(params["terminal"])
		)
			throw new Error("Use an exact terminal address from this machine");
		const result = await this.host.request(
			method,
			{ ...params, terminal: `${this.machine.id}/${params["terminal"]}` },
			options,
		);
		return method === "terminal.get" || method === "terminal.kill"
			? this.local(result)
			: result;
	}
	subscribe(
		_filter: CoreEventFilter,
		onNotification: (message: CoreNotification) => void,
		options: CoreSubscribeOptions = {},
	) {
		// Core 0.1.14 can retain a pre-rename alias in its event mirror.
		// Treat events only as invalidations; get/list remain authoritative by ID.
		return this.host.subscribe(
			{},
			(message) => {
				if (message.method === "snapshot" || message.method === "missed")
					onNotification({
						...message,
						terminals: [],
					});
				else if (message.method === "heartbeat") onNotification(message);
				else if (message.method === "event")
					onNotification({
						...message,
						event: {
							seq: message.event.seq,
							type: "reconcile",
							data: {},
						},
					});
			},
			options,
		);
	}
}
