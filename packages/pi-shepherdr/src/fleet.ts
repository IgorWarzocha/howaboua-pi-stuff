import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { getSnapshot } from "./herdr.js";
import { HerdrClient, type HerdrConnection } from "./herdr-client.js";
import {
	LOCAL_MACHINE,
	type MachinesConfig,
	type RemoteMachineConfig,
	readMachinesConfig,
} from "./machines-config.js";
import { AgentMonitor } from "./monitor.js";
import { parseMonitoredAgent } from "./monitor-record.js";
import { RemoteHerdrClient } from "./remote-client.js";
import type {
	MachineStatus,
	MonitoredAgent,
	ScopedMonitoredAgent,
	SessionSnapshot,
} from "./types.js";
import { renderAgentWidget } from "./widget.js";

const MONITOR_STATE_TYPE = "herdr-agents-monitor-state";

interface Runtime {
	attempting?: boolean;
	client?: HerdrConnection;
	config?: RemoteMachineConfig;
	local: boolean;
	monitor?: AgentMonitor;
	pending: unknown[];
	reason?: string;
	status: MachineStatus["status"];
}

export interface ConnectedMachine {
	client: HerdrConnection;
	fallbackCwd: string;
	local: boolean;
	machine: string;
	monitor: AgentMonitor;
	resolveDirectory?: (
		value: string | undefined,
		fallback: string,
	) => Promise<string>;
}

export interface MachineSnapshot extends MachineStatus {
	monitoredPaneIds?: ReadonlySet<string>;
	snapshot?: SessionSnapshot;
	snapshotError?: string;
}

function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length <= 500 ? message : `${message.slice(0, 499)}…`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function operatorPrefix(config: RemoteMachineConfig): string {
	const socket = config.socket?.startsWith("~/")
		? `HERDR_SOCKET_PATH="$HOME"/${shellQuote(config.socket.slice(2))}`
		: config.socket === "~"
			? 'HERDR_SOCKET_PATH="$HOME"'
			: config.socket
				? `HERDR_SOCKET_PATH=${shellQuote(config.socket)}`
				: undefined;
	const remote = socket
		? ["env", socket, config.herdr]
		: [config.herdr, ...(config.session ? ["--session", config.session] : [])];
	return [...config.command, ...remote].map(shellQuote).join(" ");
}

function sameMachineConfig(
	left: RemoteMachineConfig,
	right: RemoteMachineConfig,
): boolean {
	return (
		left.herdr === right.herdr &&
		left.node === right.node &&
		left.session === right.session &&
		left.socket === right.socket &&
		left.command.length === right.command.length &&
		left.command.every((part, index) => part === right.command[index])
	);
}

function savedAgents(ctx: ExtensionContext): unknown[] {
	let latest: unknown[] = [];
	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "custom" || entry.customType !== MONITOR_STATE_TYPE)
			continue;
		const data = entry.data as { agents?: unknown };
		if (Array.isArray(data?.agents)) latest = data.agents;
	}
	return latest;
}

function groupSaved(values: unknown[]): Map<string, unknown[]> {
	const grouped = new Map<string, unknown[]>();
	for (const value of values) {
		const machine =
			typeof value === "object" &&
			value !== null &&
			"machine" in value &&
			typeof value.machine === "string"
				? value.machine
				: LOCAL_MACHINE;
		const records = grouped.get(machine) ?? [];
		records.push(value);
		grouped.set(machine, records);
	}
	return grouped;
}

export class AgentFleet {
	private config: MachinesConfig = { machines: {} };
	private context: ExtensionContext | undefined;
	private generation = 0;
	private readonly pi: ExtensionAPI;
	private readonly runtimes = new Map<string, Runtime>();

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	async activate(ctx: ExtensionContext): Promise<void> {
		this.deactivate();
		const generation = this.generation;
		this.context = ctx;
		const config = await readMachinesConfig();
		if (!this.isCurrent(generation, ctx)) return;
		this.config = config;
		const grouped = groupSaved(savedAgents(ctx));
		const known = new Set([
			LOCAL_MACHINE,
			...Object.keys(this.config.machines),
		]);
		const orphaned = [...grouped.entries()]
			.filter(([machine]) => !known.has(machine))
			.reduce((count, [, records]) => count + records.length, 0);
		if (orphaned > 0) {
			ctx.ui.notify(
				`Ignored ${orphaned} saved Shepherdr ${orphaned === 1 ? "agent" : "agents"} from removed machines`,
				"warning",
			);
		}

		const localRuntime: Runtime = {
			local: true,
			pending: grouped.get(LOCAL_MACHINE) ?? [],
			status: "connecting",
		};
		this.runtimes.set(LOCAL_MACHINE, localRuntime);
		for (const [name, config] of Object.entries(this.config.machines)) {
			this.runtimes.set(name, {
				config,
				local: false,
				pending: grouped.get(name) ?? [],
				status: "connecting",
			});
		}

		const localClient = new HerdrClient();
		await localClient.request("ping");
		if (!this.isCurrent(generation, ctx)) return;
		const localMonitor = this.createMonitor(
			LOCAL_MACHINE,
			localRuntime,
			localClient,
		);
		localRuntime.client = localClient;
		localRuntime.monitor = localMonitor;
		await localMonitor.activate(ctx, localRuntime.pending);
		if (
			!this.isCurrent(generation, ctx) ||
			this.runtimes.get(LOCAL_MACHINE) !== localRuntime ||
			localRuntime.client !== localClient ||
			localRuntime.monitor !== localMonitor
		) {
			localMonitor.deactivate();
			return;
		}
		localRuntime.pending = [];
		localRuntime.status = "connected";
		this.refresh();

		for (const name of Object.keys(this.config.machines)) {
			void this.connectMachine(name, generation, true);
		}
	}

	deactivate(): void {
		this.generation += 1;
		for (const runtime of this.runtimes.values()) {
			runtime.monitor?.deactivate();
			if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
		}
		this.runtimes.clear();
		renderAgentWidget(this.context, [], []);
		this.context = undefined;
	}

	isActive(): boolean {
		return this.context !== undefined;
	}

	async reload(): Promise<void> {
		const ctx = this.context;
		if (!ctx) return;
		const generation = this.generation;
		const config = await readMachinesConfig();
		if (!this.isCurrent(generation, ctx)) return;
		const reconnect: string[] = [];

		for (const [name, runtime] of this.runtimes) {
			if (runtime.local || Object.hasOwn(config.machines, name)) continue;
			runtime.monitor?.deactivate();
			if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
			this.runtimes.delete(name);
		}
		for (const [name, machineConfig] of Object.entries(config.machines)) {
			const runtime = this.runtimes.get(name);
			if (runtime?.config && sameMachineConfig(runtime.config, machineConfig)) {
				continue;
			}
			const pending = runtime?.monitor?.list() ?? runtime?.pending ?? [];
			runtime?.monitor?.deactivate();
			if (runtime?.client instanceof RemoteHerdrClient) runtime.client.close();
			this.runtimes.set(name, {
				config: machineConfig,
				local: false,
				pending,
				status: "connecting",
			});
			reconnect.push(name);
		}
		this.config = config;
		this.changed();
		for (const name of reconnect) {
			void this.connectMachine(name, generation, true);
		}
	}

	statuses(): MachineStatus[] {
		return [...this.runtimes.entries()].map(([name, runtime]) => ({
			name,
			local: runtime.local,
			status: runtime.status,
			...(runtime.reason ? { reason: runtime.reason } : {}),
		}));
	}

	list(): ScopedMonitoredAgent[] {
		return [...this.runtimes.entries()].flatMap(([machine, runtime]) => {
			const values = runtime.monitor?.list() ?? runtime.pending;
			return values
				.map((value) => parseMonitoredAgent(value))
				.filter((value): value is MonitoredAgent => value !== undefined)
				.map((agent) => ({ ...agent, machine }));
		});
	}

	connected(machine?: string): ConnectedMachine {
		const name = machine?.trim() || LOCAL_MACHINE;
		const runtime = this.runtimes.get(name);
		if (!runtime) {
			throw new Error(
				`unknown Herdr machine ${JSON.stringify(name)}; use list to see configured machines`,
			);
		}
		if (runtime.status !== "connected" || !runtime.client || !runtime.monitor) {
			throw new Error(
				`Herdr machine ${JSON.stringify(name)} is ${runtime.status}${runtime.reason ? `: ${runtime.reason}` : ""}; run /herdr connect ${name} to retry`,
			);
		}
		const remote =
			runtime.client instanceof RemoteHerdrClient ? runtime.client : undefined;
		return {
			machine: name,
			local: runtime.local,
			client: runtime.client,
			monitor: runtime.monitor,
			fallbackCwd: runtime.local ? (this.context?.cwd ?? ".") : "~",
			...(remote
				? {
						resolveDirectory: (value: string | undefined, fallback: string) =>
							remote.directory(value, fallback),
					}
				: {}),
		};
	}

	private isCurrent(generation: number, ctx: ExtensionContext): boolean {
		return generation === this.generation && ctx === this.context;
	}

	async snapshots(machine?: string): Promise<MachineSnapshot[]> {
		const selected = machine?.trim()
			? [this.statusFor(machine.trim())]
			: this.statuses();
		return Promise.all(
			selected.map(async (status) => {
				const runtime = this.runtimes.get(status.name);
				if (
					status.status !== "connected" ||
					!runtime?.client ||
					!runtime.monitor
				)
					return status;
				const client = runtime.client;
				const monitor = runtime.monitor;
				try {
					const snapshot = await getSnapshot(client);
					if (
						runtime.status !== "connected" ||
						runtime.client !== client ||
						runtime.monitor !== monitor ||
						this.runtimes.get(status.name) !== runtime
					) {
						return this.runtimes.has(status.name)
							? this.statusFor(status.name)
							: status;
					}
					return {
						...status,
						monitoredPaneIds: new Set(
							monitor.list().map((record) => record.paneId),
						),
						snapshot,
					};
				} catch (error) {
					if (
						runtime.status !== "connected" ||
						runtime.client !== client ||
						runtime.monitor !== monitor ||
						this.runtimes.get(status.name) !== runtime
					) {
						return this.runtimes.has(status.name)
							? this.statusFor(status.name)
							: status;
					}
					return { ...status, snapshotError: errorMessage(error) };
				}
			}),
		);
	}

	connect(machine?: string): string {
		const target = machine?.trim();
		if (target) {
			const runtime = this.runtimes.get(target);
			if (!runtime)
				throw new Error(`unknown Herdr machine ${JSON.stringify(target)}`);
			if (runtime.local) {
				return `${target} is the local machine and is already connected`;
			}
			if (runtime.status === "connected") {
				return `${target} is already connected`;
			}
			if (runtime.attempting || runtime.status === "connecting") {
				return `${target} is already connecting`;
			}
			void this.connectMachine(target, this.generation, false);
			return `Connecting to ${target}`;
		}

		const names = [...this.runtimes.entries()]
			.filter(
				([, runtime]) =>
					!runtime.local &&
					runtime.status !== "connected" &&
					!runtime.attempting,
			)
			.map(([name]) => name);
		for (const name of names) {
			void this.connectMachine(name, this.generation, false);
		}
		if (names.length > 0) {
			return `Connecting to ${names.join(", ")}`;
		}
		const remotes = [...this.runtimes.entries()].filter(
			([, runtime]) => !runtime.local,
		);
		if (remotes.length === 0) {
			return "No remote machines are configured";
		}
		const connecting = remotes
			.filter(([, runtime]) => runtime.attempting)
			.map(([name]) => name);
		return connecting.length > 0
			? `Already connecting to ${connecting.join(", ")}`
			: "All configured machines are connected";
	}

	private statusFor(name: string): MachineStatus {
		const runtime = this.runtimes.get(name);
		if (!runtime)
			throw new Error(`unknown Herdr machine ${JSON.stringify(name)}`);
		return {
			name,
			local: runtime.local,
			status: runtime.status,
			...(runtime.reason ? { reason: runtime.reason } : {}),
		};
	}

	private createMonitor(
		machine: string,
		runtime: Runtime,
		client: HerdrConnection,
	): AgentMonitor {
		return new AgentMonitor(this.pi, {
			client,
			machine,
			onChange: () => this.changed(),
			onRefresh: () => this.refresh(),
			operatorPrefix: runtime.local ? "herdr" : operatorPrefix(runtime.config!),
			onWarning: runtime.local
				? (message) => this.context?.ui.notify(message, "warning")
				: (message) => {
						if (this.runtimes.get(machine) === runtime) {
							this.disconnected(machine, runtime, message);
						}
					},
			reconnect: runtime.local,
			...(client instanceof RemoteHerdrClient ? { reader: client } : {}),
			...(runtime.local && process.env["HERDR_PANE_ID"]
				? { selfPaneId: process.env["HERDR_PANE_ID"] }
				: {}),
		});
	}

	private async connectMachine(
		name: string,
		generation: number,
		initial: boolean,
	): Promise<void> {
		const runtime = this.runtimes.get(name);
		const ctx = this.context;
		if (
			!runtime?.config ||
			runtime.local ||
			runtime.status === "connected" ||
			runtime.attempting ||
			!ctx ||
			generation !== this.generation
		) {
			return;
		}
		runtime.attempting = true;
		runtime.status = "connecting";
		delete runtime.reason;
		this.refresh();
		let attached = false;
		let client: RemoteHerdrClient | undefined;
		try {
			client = await RemoteHerdrClient.connect(runtime.config, (error) => {
				if (runtime.client === client)
					this.disconnected(name, runtime, error.message);
			});
			if (
				!this.isCurrent(generation, ctx) ||
				this.runtimes.get(name) !== runtime
			) {
				client.close();
				return;
			}
			await client.request("ping");
			if (
				!this.isCurrent(generation, ctx) ||
				this.runtimes.get(name) !== runtime
			) {
				client.close();
				return;
			}
			const monitor = this.createMonitor(name, runtime, client);
			runtime.client = client;
			runtime.monitor = monitor;
			attached = true;
			await monitor.activate(ctx, runtime.pending);
			if (
				!this.isCurrent(generation, ctx) ||
				this.runtimes.get(name) !== runtime ||
				runtime.client !== client ||
				runtime.monitor !== monitor
			) {
				monitor.deactivate();
				client.close();
				return;
			}
			runtime.pending = [];
			runtime.status = "connected";
			delete runtime.attempting;
			this.refresh();
			if (!initial) ctx.ui.notify(`Connected to ${name}`, "info");
		} catch (error) {
			delete runtime.attempting;
			client?.close();
			if (generation !== this.generation || ctx !== this.context) return;
			if (
				this.runtimes.get(name) !== runtime ||
				(attached && runtime.client !== client)
			) {
				return;
			}
			this.disconnected(name, runtime, errorMessage(error));
		}
	}

	private disconnected(name: string, runtime: Runtime, reason: string): void {
		reason = errorMessage(reason);
		if (runtime.status === "unavailable" && runtime.reason === reason) return;
		if (runtime.monitor) {
			runtime.pending = runtime.monitor.list();
			runtime.monitor.deactivate();
		}
		if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
		delete runtime.monitor;
		delete runtime.client;
		runtime.status = "unavailable";
		delete runtime.attempting;
		runtime.reason = reason;
		this.changed();
		this.context?.ui.notify(
			`Shepherdr could not connect to ${name}: ${reason}\nRun /herdr connect ${name} to retry`,
			"warning",
		);
	}

	private changed(): void {
		if (!this.context) return;
		const agents = this.persistedAgents();
		this.pi.appendEntry(MONITOR_STATE_TYPE, { agents });
		this.refresh();
	}

	private refresh(): void {
		if (!this.context) return;
		renderAgentWidget(this.context, this.list(), this.statuses());
	}

	private persistedAgents(): Array<MonitoredAgent & { machine: string }> {
		return [...this.runtimes.entries()].flatMap(([machine, runtime]) => {
			const values = runtime.monitor?.list() ?? runtime.pending;
			return values
				.map((value) => parseMonitoredAgent(value))
				.filter((value): value is MonitoredAgent => value !== undefined)
				.map((value) => ({ ...value, machine }));
		});
	}
}
