import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CoreConnection } from "../core/backend.js";
import type { AgentMonitor } from "../monitor.js";
import { RemoteHerdrClient } from "../remote/client.js";
import { errorMessage, type MachineRuntime } from "./machine.js";

interface ConnectionEvents {
	isCurrent(): boolean;
	refresh(): void;
	createMonitor(client: RemoteHerdrClient | CoreConnection): AgentMonitor;
	needsContextRelay(): boolean;
	prepareContextRelay(
		client: RemoteHerdrClient | CoreConnection,
	): Promise<void>;
	disconnected(reason: string): void;
}

/** Owns remote connection attachment, stale-attempt cleanup and degraded-monitor acceptance. */
export async function connectMachine(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	name: string,
	runtime: MachineRuntime,
	ctx: ExtensionContext,
	initial: boolean,
	events: ConnectionEvents,
): Promise<void> {
	if (
		(!runtime.config && !runtime.coreMachine) ||
		runtime.local ||
		runtime.status === "connected" ||
		runtime.attempting ||
		!events.isCurrent()
	) {
		return;
	}
	runtime.attempting = true;
	runtime.status = "connecting";
	delete runtime.reason;
	events.refresh();
	let attached = false;
	let client: RemoteHerdrClient | CoreConnection | undefined;
	try {
		if (runtime.coreMachine) {
			client = new CoreConnection(
				process.env["HC_TERMINAL_SOCKET"],
				runtime.coreMachine,
			);
		} else {
			client = await RemoteHerdrClient.connect(runtime.config!, (error) => {
				if (runtime.client === client) events.disconnected(error.message);
			});
		}
		if (!events.isCurrent() || runtimes.get(name) !== runtime) {
			client.close();
			return;
		}
		await client.request("ping");
		if (!events.isCurrent() || runtimes.get(name) !== runtime) {
			client.close();
			return;
		}
		const pending = runtime.monitor?.list() ?? runtime.pending;
		const monitor = events.createMonitor(client);
		runtime.client = client;
		runtime.monitor = monitor;
		attached = true;
		await monitor.activate(ctx, pending);
		if (
			!events.isCurrent() ||
			runtimes.get(name) !== runtime ||
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
		// Late connections must see optional sharing owners that finished startup.
		if (events.needsContextRelay())
			await events.prepareContextRelay(client).catch(() => {});
		if (!events.isCurrent() || runtime.client !== client) return;
		events.refresh();
		if (!initial) ctx.ui.notify(`Connected to ${name}`, "info");
	} catch (error) {
		delete runtime.attempting;
		if (
			events.isCurrent() &&
			runtimes.get(name) === runtime &&
			runtime.client === client &&
			runtime.monitor &&
			runtime.monitoringIssue?.state === "degraded"
		) {
			runtime.pending = [];
			runtime.status = "connected";
			events.refresh();
			return;
		}
		client?.close();
		if (!events.isCurrent()) return;
		if (
			runtimes.get(name) !== runtime ||
			(attached && runtime.client !== client)
		) {
			return;
		}
		events.disconnected(errorMessage(error));
	}
}
