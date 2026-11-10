import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CoreConnection } from "../core/backend.js";
import { AgentMonitor } from "../monitor.js";
import { errorMessage, LOCAL_MACHINE, type MachineRuntime } from "./machine.js";

interface FleetMonitorEvents {
	isAttached(): boolean;
	context(): ExtensionContext | undefined;
	changed(): void;
	refresh(): void;
	disconnected(reason: string): void;
}

/** Owns the local/remote monitoring adapter and its warning/recovery policy. */
export function createMachineMonitor(
	machine: string,
	runtime: MachineRuntime,
	client: CoreConnection,
	pi: ExtensionAPI,
	events: FleetMonitorEvents,
): AgentMonitor {
	const selfPaneId = runtime.local ? process.env["HC_TERMINAL_ID"] : undefined;
	return new AgentMonitor(pi, {
		client,
		machine,
		machineLabel: () => runtime.coreMachine?.name ?? LOCAL_MACHINE,
		onChange: () => events.changed(),
		onRefresh: () => events.refresh(),
		operatorPrefix: "hc",
		onWarning: (issue) => {
			if (!events.isAttached()) return;
			if (!runtime.local && issue.state === "unavailable") {
				events.disconnected(issue.message);
				return;
			}
			runtime.monitoringIssue = {
				...issue,
				message: errorMessage(issue.message),
			};
			events.refresh();
			events
				.context()
				?.ui.notify(
					`${machine}: ${issue.message}${runtime.local ? "" : "\nOpen /herdr → Status to reconnect"}`,
					"warning",
				);
		},
		onRecovered: () => {
			if (!events.isAttached() || !runtime.monitoringIssue) return;
			delete runtime.monitoringIssue;
			events.refresh();
			if (runtime.monitor?.list().length)
				events
					.context()
					?.ui.notify(`Core monitoring restored: ${machine}`, "info");
		},
		reconnect: runtime.local,
		...(client.reader ? { reader: client.reader } : {}),
		...(selfPaneId ? { selfPaneId } : {}),
	});
}
