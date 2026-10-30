import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "../core/backend.js";
import { CoreClient } from "../core/client.js";
import { type CoreMachine, coreMachines } from "../core/remote-exec.js";
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
import { reloadCoreCatalog, reloadSshCatalog } from "./catalog.js";
import { connectMachine } from "./connection.js";
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
	private needsContextRelay: (
		ctx: ExtensionContext,
		machine: string,
	) => boolean = () => false;
	setContextRelay(
		handler: (
			ctx: ExtensionContext,
			request: unknown,
			signal: AbortSignal,
		) => Promise<unknown>,
		needsRelay: (ctx: ExtensionContext, machine: string) => boolean,
	): void {
		this.setup.setContextRelay(handler);
		this.needsContextRelay = needsRelay;
	}
	async restoreSharing(ctx: ExtensionContext): Promise<void> {
		if (this.context !== ctx) return;
		await Promise.all(
			this.statuses()
				.filter(
					(machine) =>
						!machine.local &&
						machine.status === "connected" &&
						this.needsContextRelay(ctx, machine.id),
				)
				.map((machine) =>
					this.connected(machine.id)
						.prepareSharing()
						.catch(() => {}),
				),
		);
	}
	private context: ExtensionContext | undefined;
	private generation = 0;
	private readonly pi: ExtensionAPI;
	private readonly runtimes = new Map<string, MachineRuntime>();
	private localCoreId: string | undefined;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
	}

	async activate(ctx: ExtensionContext): Promise<void> {
		this.deactivate();
		const generation = this.generation;
		this.context = ctx;
		const catalog = process.env["HC_TERMINAL_SOCKET"]
			? {}
			: await readMachineCatalog();
		if (!this.isCurrent(generation, ctx)) return;
		const machines = Object.entries(catalog).filter(
			([, machine]) => machine.enabled,
		);
		if (process.env["HC_TERMINAL_SOCKET"]) {
			const identityClient = new CoreConnection();
			let coreId: string;
			try {
				coreId = (await identityClient.machineIdentity()).session;
			} finally {
				identityClient.close();
			}
			if (!this.isCurrent(generation, ctx)) return;
			this.localCoreId = coreId;
		}
		const grouped = groupSaved(savedAgents(ctx, this.localCoreId));
		const coreCatalog = await this.coreCatalog();
		if (!this.isCurrent(generation, ctx)) return;
		const known = new Set([
			LOCAL_MACHINE,
			...machines.map(([id]) => id),
			...coreCatalog.map((machine) => machine.id),
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
		for (const machine of coreCatalog)
			this.runtimes.set(machine.id, {
				coreMachine: machine,
				local: false,
				pending: grouped.get(machine.id) ?? [],
				status: "connecting",
			});

		const localClient = process.env["HC_TERMINAL_SOCKET"]
			? new CoreConnection()
			: new HerdrClient();
		await localClient.request("ping");
		if (!this.isCurrent(generation, ctx)) {
			if (localClient instanceof CoreConnection) localClient.close();
			return;
		}
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
		for (const machine of coreCatalog)
			void this.connectMachine(machine.id, generation, true);
	}

	deactivate(): void {
		this.generation += 1;
		this.localCoreId = undefined;
		for (const runtime of this.runtimes.values()) {
			runtime.monitor?.deactivate();
			if (
				runtime.client instanceof RemoteHerdrClient ||
				runtime.client instanceof CoreConnection
			)
				runtime.client.close();
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
		if (process.env["HC_TERMINAL_SOCKET"]) {
			const catalog = await this.coreCatalog();
			if (!this.isCurrent(generation, ctx)) return;
			reloadCoreCatalog(this.runtimes, catalog, (id) => {
				void this.connectMachine(id, generation, true);
			});
			this.changed();
			return;
		}
		const catalog = process.env["HC_TERMINAL_SOCKET"]
			? {}
			: await readMachineCatalog();
		if (!this.isCurrent(generation, ctx)) return;
		const reconnect = reloadSshCatalog(this.runtimes, catalog);
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
		const ctx = this.context;
		return connectedMachine(
			this.runtimes,
			ctx,
			async (name, runtime, client) => {
				if (
					!ctx ||
					this.context !== ctx ||
					this.runtimes.get(name) !== runtime ||
					runtime.client !== client
				)
					throw new Error(
						"Session changed; retry sharing from the current session",
					);
				if (runtime.local) return;
				if (
					!(
						client instanceof RemoteHerdrClient ||
						client instanceof CoreConnection
					)
				)
					throw new Error("Context sharing is unavailable on this machine");
				await this.prepareContextRelay(name, runtime, client, ctx);
				if (
					this.context !== ctx ||
					this.runtimes.get(name) !== runtime ||
					runtime.client !== client
				)
					throw new Error(
						"Session changed; retry sharing from the current session",
					);
				client.contextRelayPath();
			},
			machine,
		);
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
		client: RemoteHerdrClient | CoreConnection,
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
		if (!runtime || !ctx) return;
		return connectMachine(this.runtimes, name, runtime, ctx, initial, {
			isCurrent: () => this.isCurrent(generation, ctx),
			refresh: () => this.refresh(),
			createMonitor: (client) => this.createMonitor(name, runtime, client),
			needsContextRelay: () => this.needsContextRelay(ctx, name),
			prepareContextRelay: (client) =>
				this.prepareContextRelay(name, runtime, client, ctx),
			disconnected: (reason) => this.disconnected(name, runtime, reason),
		});
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
		if (
			runtime.client instanceof RemoteHerdrClient ||
			runtime.client instanceof CoreConnection
		)
			runtime.client.close();
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
		this.pi.appendEntry(MONITOR_STATE_TYPE, {
			version: 2,
			agents,
			...(this.localCoreId ? { localCoreId: this.localCoreId } : {}),
		});
		this.refresh();
	}
	private async coreCatalog(): Promise<CoreMachine[]> {
		const socket = process.env["HC_TERMINAL_SOCKET"];
		if (!socket) return [];
		const client = new CoreClient(socket);
		try {
			return await coreMachines(client);
		} finally {
			client.close();
		}
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
