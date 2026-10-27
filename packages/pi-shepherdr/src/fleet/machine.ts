import type { HerdrConnection } from "../herdr-client.js";
import type { SshMachine } from "../machine-catalog.js";
import type { AgentMonitor } from "../monitor.js";
import type {
	MachineStatus,
	MonitoringIssue,
	SessionSnapshot,
} from "../types.js";

export interface MachineRuntime {
	attempting?: boolean;
	client?: HerdrConnection;
	config?: SshMachine;
	contextRelayError?: string;
	local: boolean;
	monitor?: AgentMonitor;
	monitoringIssue?: MonitoringIssue;
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

export function errorMessage(error: unknown): string {
	const message = error instanceof Error ? error.message : String(error);
	return message.length <= 500 ? message : `${message.slice(0, 499)}…`;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", `'"'"'`)}'`;
}

export function operatorPrefix(config: SshMachine): string {
	return `ssh -T -o BatchMode=yes -- ${shellQuote(config.target)} herdr --session ${shellQuote(config.session)}`;
}
