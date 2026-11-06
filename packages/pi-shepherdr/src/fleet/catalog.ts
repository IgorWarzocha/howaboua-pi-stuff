import type { CoreMachine } from "../core/machines.js";
import type { MachineRuntime } from "./machine.js";

/** Catalog names are metadata: renames must not replace stable connection owners. */
export function reloadCoreCatalog(
	runtimes: Map<string, MachineRuntime>,
	catalog: CoreMachine[],
	connect: (id: string) => void,
): void {
	const ids = new Set(catalog.map((machine) => machine.id));
	for (const [id, runtime] of runtimes) {
		if (runtime.local || ids.has(id)) continue;
		runtime.monitor?.deactivate();
		runtime.client?.close();
		runtimes.delete(id);
	}
	for (const machine of catalog) {
		if (
			[...runtimes.values()].some(
				(runtime) => runtime.local && runtime.coreId === machine.id,
			)
		)
			continue;
		let runtime = runtimes.get(machine.id);
		if (runtime?.coreMachine) {
			// Live Core endpoints retain this object for address qualification.
			Object.assign(runtime.coreMachine, machine);
		} else if (runtime) runtime.coreMachine = machine;
		else {
			runtime = {
				coreId: machine.id,
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
