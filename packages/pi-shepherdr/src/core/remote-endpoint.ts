import { CoreAdmission } from "./admission.js";
import {
	CoreClient,
	type CoreEventFilter,
	type CoreRequestOptions,
	type CoreSubscribeOptions,
} from "./client.js";
import type { CoreMachine } from "./machines.js";
import { type CoreNotification, type CoreObject, object } from "./protocol.js";
import { CoreRemoteTransport } from "./remote-transport.js";

/** A verified remote Core, addressed by ID; native terminal addresses stay local. */
export class RemoteCoreEndpoint {
	readonly host: CoreClient;
	private transport: CoreRemoteTransport | undefined;
	private ended = false;
	private readonly socketPath: string;
	readonly machine: CoreMachine;
	private readonly admission: CoreAdmission;
	constructor(
		socketPath: string,
		machine: CoreMachine,
		admission = new CoreAdmission(socketPath, machine.id),
	) {
		this.socketPath = socketPath;
		this.machine = machine;
		this.admission = admission;
		this.host = new CoreClient(socketPath);
	}
	get bridge(): CoreRemoteTransport {
		if (this.ended) throw new Error("Remote Core connection closed");
		return (this.transport ??= new CoreRemoteTransport(
			this.socketPath,
			this.machine,
		));
	}
	close(): void {
		this.ended = true;
		this.admission.close();
		void this.transport?.close();
		this.host.close();
	}
	call(input: CoreObject, options: CoreRequestOptions = {}): Promise<unknown> {
		if (
			[
				"saved_session",
				"find_saved_sessions",
				"view",
				"session_header",
			].includes(String(input["op"]))
		)
			return this.admission.run(
				"bulk",
				() => this.bridge.call(input, options),
				options.signal,
			);
		return this.bridge.call(input, options);
	}
	localSnapshot(): Promise<unknown> {
		return this.call({ op: "core", method: "terminal.list", params: {} });
	}
	async request(
		method: string,
		params: CoreObject = {},
		options: CoreRequestOptions = {},
	): Promise<unknown> {
		if (method === "hello") {
			// Catalogue connection checks do not launch idle filesystem helpers.
			const catalog = object(
				await this.host.request("machine.list", {}, options),
			)["machines"];
			const selected = Array.isArray(catalog)
				? catalog.map(object).find((entry) => entry["id"] === this.machine.id)
				: undefined;
			if (selected?.["state"] !== "connected")
				throw new Error(
					"Remote Core is disconnected; open /herdr → Status to reconnect",
				);
			return {
				version: selected["version"],
				core: { id: this.machine.id, name: this.machine.host },
			};
		}
		if (method === "terminal.run") {
			// The originating Core qualifies caller ancestry across the route.
			return this.local(
				await this.host.request(
					method,
					{ ...params, on: this.machine.id, env: {} },
					options,
				),
			);
		}
		if (typeof params["terminal"] === "string") {
			if (!/^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/.test(params["terminal"]))
				throw new Error("Use an exact terminal address from this machine");
			const result = await this.host.request(
				method,
				{ ...params, terminal: `${this.machine.id}/${params["terminal"]}` },
				options,
			);
			return ["terminal.get", "terminal.kill", "terminal.label"].includes(
				method,
			)
				? this.local(result)
				: result;
		}
		return this.call({ op: "core", method, params }, options);
	}
	private local(value: unknown): CoreObject {
		const record = object(value);
		const address = record["address"];
		const terminal =
			typeof address === "string" ? address.split("/").at(-1) : undefined;
		if (!terminal || !/^t[1-9][0-9bcdfghjkmnpqrstvwxyz]*$/.test(terminal))
			throw new Error("Remote Core returned an invalid terminal address");
		return { ...record, address: terminal };
	}
	subscribe(
		filter: CoreEventFilter,
		onNotification: (message: CoreNotification) => void,
		options: CoreSubscribeOptions = {},
	) {
		return this.bridge.subscribe({ ...filter }, onNotification, options);
	}
}
