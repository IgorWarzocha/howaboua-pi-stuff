import { CoreConnection } from "../core/backend.js";
import type { CoreMachine } from "../core/remote-exec.js";
import type { SshMachine } from "../machine-catalog.js";
import { RemoteHerdrClient } from "../remote/client.js";
import type { MachineRuntime } from "./machine.js";

/** Reconcile catalog changes without changing fleet identity or scheduling retries. */
export function reloadCoreCatalog(
	runtimes: Map<string, MachineRuntime>,
	catalog: CoreMachine[],
	connect: (id: string) => void,
): void {
	for (const [id, runtime] of runtimes) {
		if (
			runtime.local ||
			catalog.some(
				(machine) =>
					machine.id === id && machine.name === runtime.coreMachine?.name,
			)
		)
			continue;
		runtime.monitor?.deactivate();
		if (runtime.client instanceof CoreConnection) runtime.client.close();
		if (!catalog.some((machine) => machine.id === id)) runtimes.delete(id);
		else {
			runtime.pending = runtime.monitor?.list() ?? runtime.pending;
			delete runtime.client;
			delete runtime.monitor;
			runtime.status = "unavailable";
		}
	}
	for (const machine of catalog) {
		let runtime = runtimes.get(machine.id);
		if (runtime) runtime.coreMachine = machine;
		else {
			runtime = {
				coreMachine: machine,
				local: false,
				pending: [],
				status: "connecting",
			};
			runtimes.set(machine.id, runtime);
		}
		if (!runtime.client) connect(machine.id);
	}
}

export function reloadSshCatalog(
	runtimes: Map<string, MachineRuntime>,
	catalog: Record<string, SshMachine>,
): string[] {
	const reconnect: string[] = [];

	for (const [name, runtime] of runtimes) {
		if (runtime.local || catalog[name]?.enabled) continue;
		runtime.monitor?.deactivate();
		if (runtime.client instanceof RemoteHerdrClient) runtime.client.close();
		runtimes.delete(name);
	}
	for (const [name, machineConfig] of Object.entries(catalog)) {
		if (!machineConfig.enabled) continue;
		const runtime = runtimes.get(name);
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
		runtimes.set(name, {
			config: machineConfig,
			local: false,
			pending,
			status: "connecting",
		});
		reconnect.push(name);
	}
	return reconnect;
}
