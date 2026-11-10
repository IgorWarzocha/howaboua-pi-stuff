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

/** Local alias and stable IDs win over mutable catalog names; never infer hosts. */
export function resolveMachine(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	selector: string,
): string {
	const target = selector.trim();
	if (runtimes.has(target)) return target;
	const byId = [...runtimes].find(([, runtime]) => runtime.coreId === target);
	if (byId) return byId[0];
	const matches = [...runtimes].filter(
		([, runtime]) => runtime.coreMachine?.name === target,
	);
	const match = matches[0];
	if (matches.length === 1 && match) return match[0];
	if (matches.length > 1)
		throw new Error(
			`Ambiguous Core machine ${JSON.stringify(target)}; use a stable machine ID: ${matches.map(([id]) => id).join(", ")}`,
		);
	throw new Error(
		`Unknown Core machine ${JSON.stringify(target)}; use list to see current machines or ${LOCAL_MACHINE}`,
	);
}
