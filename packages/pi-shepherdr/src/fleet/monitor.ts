import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { HerdrConnection } from "../herdr-client.js";
import { LOCAL_MACHINE } from "../machine-catalog.js";
import { AgentMonitor } from "../monitor.js";
import { RemoteHerdrClient } from "../remote/client.js";
import {
	errorMessage,
	type MachineRuntime,
	operatorPrefix,
} from "./machine.js";

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
	client: HerdrConnection,
	pi: ExtensionAPI,
	events: FleetMonitorEvents,
): AgentMonitor {
	return new AgentMonitor(pi, {
		client,
		machine,
		machineLabel: () => runtime.config?.label ?? LOCAL_MACHINE,
		onChange: () => events.changed(),
		onRefresh: () => events.refresh(),
		operatorPrefix: runtime.local ? "herdr" : operatorPrefix(runtime.config!),
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
					?.ui.notify(`Herdr monitoring restored: ${machine}`, "info");
		},
		reconnect: runtime.local,
		...(client instanceof RemoteHerdrClient ? { reader: client } : {}),
		...(runtime.local && process.env["HERDR_PANE_ID"]
			? { selfPaneId: process.env["HERDR_PANE_ID"] }
			: {}),
	});
}
