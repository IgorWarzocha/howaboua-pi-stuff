import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getSnapshot } from "../core/agents.js";
import { parseMonitoredAgent } from "../monitor-record.js";
import type {
	MachineStatus,
	MonitoredAgent,
	ScopedMonitoredAgent,
} from "../types.js";
import {
	type ConnectedMachine,
	errorMessage,
	LOCAL_MACHINE,
	type MachineRuntime,
	type MachineSnapshot,
	resolveMachine,
} from "./machine.js";

export function listAgents(
	runtimes: ReadonlyMap<string, MachineRuntime>,
): ScopedMonitoredAgent[] {
	return [...runtimes.entries()].flatMap(([machine, runtime]) => {
		const values = runtime.monitor?.list() ?? runtime.pending;
		return values
			.map((value) => parseMonitoredAgent(value))
			.filter((value): value is MonitoredAgent => value !== undefined)
			.map((agent) => ({ ...agent, machine }));
	});
}

export function connectedMachine(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	context: ExtensionContext | undefined,
	prepareSharing: (
		machine: string,
		runtime: MachineRuntime,
		client: NonNullable<MachineRuntime["client"]>,
	) => Promise<void>,
	machine?: string,
): ConnectedMachine {
	const name = resolveMachine(runtimes, machine?.trim() || LOCAL_MACHINE);
	const runtime = runtimes.get(name);
	if (!runtime) {
		throw new Error(
			`Unknown Core machine ${JSON.stringify(name)}; use list to see current machines`,
		);
	}
	if (runtime.status !== "connected" || !runtime.client || !runtime.monitor) {
		throw new Error(
			`Core machine ${JSON.stringify(name)} is ${runtime.status}${runtime.reason ? `: ${runtime.reason}` : ""}; open /herdr → Status to reconnect`,
		);
	}
	const remote = runtime.client.remote ? runtime.client : undefined;
	const client = runtime.client;
	return {
		prepareSharing: () => prepareSharing(name, runtime, client),
		machine: name,
		local: runtime.local,
		client: runtime.client,
		monitor: runtime.monitor,
		fallbackCwd: runtime.local ? (context?.cwd ?? ".") : "~",
		...(remote
			? {
					resolveDirectory: (value: string | undefined, fallback: string) =>
						remote.directory(value, fallback),
				}
			: {}),
	};
}

export async function machineSnapshots(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	machine?: string,
): Promise<MachineSnapshot[]> {
	const selected = machine?.trim()
		? [statusFor(runtimes, resolveMachine(runtimes, machine))]
		: [...runtimes.keys()].map((name) => statusFor(runtimes, name));
	return Promise.all(
		selected.map(async (status) => {
			const runtime = runtimes.get(status.id);
			if (status.status !== "connected" || !runtime?.client || !runtime.monitor)
				return status;
			const client = runtime.client;
			const monitor = runtime.monitor;
			try {
				const snapshot = await getSnapshot(client);
				if (
					runtime.status !== "connected" ||
					runtime.client !== client ||
					runtime.monitor !== monitor ||
					runtimes.get(status.id) !== runtime
				) {
					return runtimes.has(status.id)
						? statusFor(runtimes, status.id)
						: status;
				}
				return {
					...status,
					monitoredPaneIds: new Set(
						monitor.list().map((record) => record.paneId),
					),
					snapshot,
				};
			} catch (error) {
				if (
					runtime.status !== "connected" ||
					runtime.client !== client ||
					runtime.monitor !== monitor ||
					runtimes.get(status.id) !== runtime
				) {
					return runtimes.has(status.id)
						? statusFor(runtimes, status.id)
						: status;
				}
				return { ...status, snapshotError: errorMessage(error) };
			}
		}),
	);
}

export function statusFor(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	name: string,
): MachineStatus {
	const runtime = runtimes.get(name);
	if (!runtime) throw new Error(`Unknown Core machine ${JSON.stringify(name)}`);
	return {
		id: name,
		local: runtime.local,
		...(runtime.coreMachine
			? {
					label: runtime.coreMachine.name,
					target: runtime.coreMachine.host,
					session: runtime.coreMachine.id,
				}
			: {}),
		status: runtime.status,
		...(runtime.monitoringIssue
			? { monitoringIssue: runtime.monitoringIssue }
			: {}),
		...(runtime.reason ? { reason: runtime.reason } : {}),
		...(runtime.contextRelayError
			? { contextRelayError: runtime.contextRelayError }
			: {}),
		...(runtime.attempting ? { attempting: true } : {}),
	};
}
