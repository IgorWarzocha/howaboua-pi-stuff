import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { HerdrClient, type HerdrConnection } from "../herdr-client.js";
import { LOCAL_MACHINE, readMachineCatalog } from "../machine-catalog.js";
import { AgentMonitor } from "../monitor.js";
import { RemoteHerdrClient } from "../remote/client.js";
import type {
	MachineStatus,
	MonitoredAgent,
	ScopedMonitoredAgent,
} from "../types.js";
import { renderAgentWidget } from "../widget.js";
import {
	connectedMachine,
	listAgents,
	machineSnapshots,
	statusFor,
} from "./inspection.js";
import {
	type ConnectedMachine,
	errorMessage,
	type MachineRuntime,
	type MachineSnapshot,
} from "./machine.js";
import { createMachineMonitor } from "./monitor.js";
import { groupSaved, MONITOR_STATE_TYPE, savedAgents } from "./persistence.js";
import { connectMachines } from "./reconnect.js";
import { FleetSetup } from "./setup.js";

export type { ConnectedMachine, MachineSnapshot } from "./machine.js";

export class AgentFleet {
	private readonly listeners = new Set<() => void>();
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	}
	private readonly setup = new FleetSetup(() => this.refresh());
	setContextRelay(
		handler: (
			ctx: ExtensionContext,
			request: unknown,
			signal: AbortSignal,
		) => Promise<unknown>,
	): void {
		this.setup.setContextRelay(handler);
	}
	private context: ExtensionContext | undefined;
	private generation = 0;
	private readonly pi: ExtensionAPI;
	private readonly runtimes = new Map<string, MachineRuntime>();

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	async activate(ctx: ExtensionContext): Promise<void> {
		this.deactivate();
		const generation = this.generation;
		this.context = ctx;
		const catalog = await readMachineCatalog();
		if (!this.isCurrent(generation, ctx)) return;
		const machines = Object.entries(catalog).filter(
			([, machine]) => machine.enabled,
		);
		const grouped = groupSaved(savedAgents(ctx));
		const known = new Set([LOCAL_MACHINE, ...machines.map(([id]) => id)]);
		const orphaned = [...grouped.entries()]
			.filter(([machine]) => !known.has(machine))
			.reduce((count, [, records]) => count + records.length, 0);
		if (orphaned > 0) {
			ctx.ui.notify(
				`Ignored ${orphaned} saved Shepherdr ${orphaned === 1 ? "agent" : "agents"} from removed machines`,
				"warning",
			);
		}

		const localRuntime: MachineRuntime = {
			local: true,
			pending: grouped.get(LOCAL_MACHINE) ?? [],
			status: "connecting",
		};
		this.runtimes.set(LOCAL_MACHINE, localRuntime);
		for (const [name, config] of machines) {
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
		this.changed();

		for (const [name] of machines) {
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
		for (const listener of this.listeners) listener();
	}

	isActive(): boolean {
		return this.context !== undefined;
	}

	async reload(): Promise<void> {
		const ctx = this.context;
		if (!ctx) return;
		const generation = this.generation;
		const catalog = await readMachineCatalog();
		if (!this.isCurrent(generation, ctx)) return;
		const reconnect: string[] = [];

		for (const [name, runtime] of this.runtimes) {
			if (runtime.local || catalog[name]?.enabled) continue;
			runtime.monitor?.deactivate();
			if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
			this.runtimes.delete(name);
		}
		for (const [name, machineConfig] of Object.entries(catalog)) {
			if (!machineConfig.enabled) continue;
			const runtime = this.runtimes.get(name);
			if (
				runtime?.config &&
				runtime.config.target === machineConfig.target &&
				runtime.config.session === machineConfig.session
			) {
				runtime.config = machineConfig;
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
		this.changed();
		for (const name of reconnect) {
			void this.connectMachine(name, generation, true);
		}
	}

	statuses(): MachineStatus[] {
		return [...this.runtimes.keys()].map((name) =>
			statusFor(this.runtimes, name),
		);
	}

	list(): ScopedMonitoredAgent[] {
		return listAgents(this.runtimes);
	}
	connected(machine?: string): ConnectedMachine {
		return connectedMachine(this.runtimes, this.context, machine);
	}
	private isCurrent(generation: number, ctx: ExtensionContext): boolean {
		return generation === this.generation && ctx === this.context;
	}

	async snapshots(machine?: string): Promise<MachineSnapshot[]> {
		return machineSnapshots(this.runtimes, machine);
	}
	connect(machine?: string): string {
		return connectMachines(
			this.runtimes,
			machine,
			(name, runtime) => this.retrySetup(name, runtime),
			(name) => this.connectMachine(name, this.generation, false),
		);
	}
	private createMonitor(
		machine: string,
		runtime: MachineRuntime,
		client: HerdrConnection,
	): AgentMonitor {
		return createMachineMonitor(machine, runtime, client, this.pi, {
			isAttached: () => this.runtimes.get(machine) === runtime,
			context: () => this.context,
			changed: () => this.changed(),
			refresh: () => this.refresh(),
			disconnected: (reason) => this.disconnected(machine, runtime, reason),
		});
	}
	private async prepareContextRelay(
		name: string,
		runtime: MachineRuntime,
		client: RemoteHerdrClient,
		ctx: ExtensionContext,
	): Promise<void> {
		return this.setup.prepareContextRelay(
			name,
			runtime,
			client,
			ctx,
			() => this.context === ctx && this.runtimes.get(name) === runtime,
		);
	}
	private async retrySetup(
		name: string,
		runtime: MachineRuntime,
	): Promise<void> {
		const ctx = this.context;
		const generation = this.generation;
		return this.setup.retrySetup(
			name,
			runtime,
			ctx,
			() => ctx !== undefined && this.isCurrent(generation, ctx),
			() => this.runtimes.get(name) === runtime,
			() => this.context === ctx && this.runtimes.get(name) === runtime,
		);
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
			await this.prepareContextRelay(name, runtime, client, ctx);
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
			const pending = runtime.monitor?.list() ?? runtime.pending;
			const monitor = this.createMonitor(name, runtime, client);
			runtime.client = client;
			runtime.monitor = monitor;
			attached = true;
			await monitor.activate(ctx, pending);
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
			if (
				this.isCurrent(generation, ctx) &&
				this.runtimes.get(name) === runtime &&
				runtime.client === client &&
				runtime.monitor &&
				runtime.monitoringIssue?.state === "degraded"
			) {
				runtime.pending = [];
				runtime.status = "connected";
				this.refresh();
				return;
			}
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

	private disconnected(
		name: string,
		runtime: MachineRuntime,
		reason: string,
	): void {
		reason = errorMessage(reason);
		if (runtime.status === "unavailable" && runtime.reason === reason) return;
		// Keep the stopped owner until reconnect so in-flight dispatch cleanup
		// updates the state we persist, rather than a detached snapshot.
		runtime.monitor?.deactivate();
		if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
		delete runtime.client;
		delete runtime.contextRelayError;
		delete runtime.monitoringIssue;
		runtime.status = "unavailable";
		delete runtime.attempting;
		runtime.reason = reason;
		this.changed();
		this.context?.ui.notify(
			`Shepherdr unavailable on ${name}: ${reason}\nOpen /herdr → Status to reconnect`,
			"warning",
		);
	}

	private changed(): void {
		if (!this.context) return;
		const agents = this.persistedAgents();
		this.pi.appendEntry(MONITOR_STATE_TYPE, { version: 2, agents });
		this.refresh();
	}

	private refresh(): void {
		if (!this.context) return;
		renderAgentWidget(this.context, this.list(), this.statuses());
		for (const listener of this.listeners) listener();
	}

	private persistedAgents(): Array<MonitoredAgent & { machine: string }> {
		return listAgents(this.runtimes);
	}
}
