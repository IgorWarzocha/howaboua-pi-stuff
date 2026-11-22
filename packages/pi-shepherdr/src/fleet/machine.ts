import type { CoreConnection } from "../core/backend.js";
import type { CoreMachine } from "../core/machines.js";
export const LOCAL_MACHINE = "local";

import type { AgentMonitor } from "../monitor.js";
import type {
	MachineStatus,
	MonitoringIssue,
	SessionSnapshot,
} from "../types.js";

export interface MachineRuntime {
	attempting?: boolean;
	client?: CoreConnection;
	coreId: string;
	coreMachine?: CoreMachine;
	contextRelayError?: string;
	local: boolean;
	localName?: string;
	monitor?: AgentMonitor;
	monitoringIssue?: MonitoringIssue;
	pending: unknown[];
	reason?: string;
	status: MachineStatus["status"];
}

export interface ConnectedMachine {
	prepareSharing: () => Promise<void>;
	client: CoreConnection;
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

export function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length <= 500 ? message : `${message.slice(0, 499)}…`;
}

function machineName(runtime: MachineRuntime): string | undefined {
	return runtime.local ? runtime.localName : runtime.coreMachine?.name;
}

function machineId(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	selector: string,
): string | undefined {
	if (runtimes.has(selector)) return selector;
	if (runtimes.get(LOCAL_MACHINE)?.coreId === selector) return LOCAL_MACHINE;
}

export function machineLabel(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	id: string,
	runtime: MachineRuntime,
): string | undefined {
	const label = machineName(runtime);
	const claimed = label && machineId(runtimes, label);
	// Do not advertise a label that routes to another machine by ID.
	if (claimed && claimed !== id) return undefined;
	return label;
}

/** Local alias and stable IDs win over Core names; never infer aliases. */
export function resolveMachine(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	selector: string,
): string {
	const target = selector.trim();
	const byId = machineId(runtimes, target);
	if (byId) return byId;
	const matches = [...runtimes].filter(
		([, runtime]) => machineName(runtime) === target,
	);
	const match = matches[0];
	if (matches.length === 1 && match) return match[0];
	if (matches.length > 1)
		throw new Error(
			`Ambiguous Core machine ${JSON.stringify(target)}; use a machine ID: ${matches.map(([id]) => id).join(", ")}`,
		);
	throw new Error(
		`Unknown Core machine ${JSON.stringify(target)}; use list for machine labels and IDs`,
	);
}
