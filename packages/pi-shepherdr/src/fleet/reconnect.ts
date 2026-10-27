import type { MachineRuntime } from "./machine.js";

/** Explicit reconnect selection and user receipts; never schedules autonomous reconnects. */
export function connectMachines(
	runtimes: ReadonlyMap<string, MachineRuntime>,
	machine: string | undefined,
	retrySetup: (name: string, runtime: MachineRuntime) => Promise<void>,
	connectMachine: (name: string) => Promise<void>,
): string {
	const target = machine?.trim();
	if (target) {
		const runtime = runtimes.get(target);
		if (!runtime)
			throw new Error(`unknown Herdr machine ${JSON.stringify(target)}`);
		if (
			runtime.status === "connected" &&
			(runtime.monitoringIssue || runtime.contextRelayError)
		) {
			if (runtime.attempting)
				return `Already retrying connection setup on ${target}`;
			void retrySetup(target, runtime);
			return `Retrying connection setup on ${target}`;
		}
		if (runtime.local) {
			return `${target} is the local machine and is already connected`;
		}
		if (runtime.status === "connected") {
			return `${target} is already connected`;
		}
		if (runtime.attempting || runtime.status === "connecting") {
			return `${target} is already connecting`;
		}
		void connectMachine(target);
		return `Connecting to ${target}`;
	}

	const retries = [...runtimes.entries()].filter(
		([, runtime]) =>
			runtime.status === "connected" &&
			(runtime.monitoringIssue || runtime.contextRelayError) &&
			!runtime.attempting,
	);
	for (const [name, runtime] of retries) void retrySetup(name, runtime);
	const names = [...runtimes.entries()]
		.filter(
			([, runtime]) =>
				!runtime.local && runtime.status !== "connected" && !runtime.attempting,
		)
		.map(([name]) => name);
	for (const name of names) {
		void connectMachine(name);
	}
	if (names.length > 0 || retries.length > 0) {
		return [
			retries.length > 0
				? `Retrying connection setup on ${retries.map(([name]) => name).join(", ")}`
				: "",
			names.length > 0 ? `Connecting to ${names.join(", ")}` : "",
		]
			.filter(Boolean)
			.join(". ");
	}
	const remotes = [...runtimes.entries()].filter(
		([, runtime]) => !runtime.local,
	);
	if (remotes.length === 0) {
		return "No remote machines are configured";
	}
	const connecting = remotes
		.filter(([, runtime]) => runtime.attempting)
		.map(([name]) => name);
	return connecting.length > 0
		? `Already connecting to ${connecting.join(", ")}`
		: "All configured machines are connected";
}
