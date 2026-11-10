import type {
	SavedSessionLoader,
	SavedSessionLocator,
} from "@howaboua/pi-agent-comms/context-sharing";
import type { AgentFleet } from "./fleet/index.js";

/** Discovery supplies locations, never family membership or permission to read them. */
export function savedContextLoader(fleet: AgentFleet): SavedSessionLoader {
	return Object.assign(
		(location: SavedSessionLocator, history: boolean, signal?: AbortSignal) =>
			fleet
				.connected(location.machine)
				.client.readSavedSession(location.sessionFile, history, signal),
		{
			async find(threadId: string, signal?: AbortSignal) {
				signal?.throwIfAborted();
				const machines = fleet.statuses();
				const connected = machines.filter(
					(machine) => machine.status === "connected",
				);
				const results = await Promise.allSettled(
					connected.map(async (machine) => ({
						machine: machine.id,
						paths: await fleet
							.connected(machine.id)
							.client.findSavedSessions(threadId, signal),
					})),
				);
				signal?.throwIfAborted();
				const locations: SavedSessionLocator[] = [];
				const unavailable = machines
					.filter((machine) => machine.status !== "connected")
					.map((machine) => machine.label ?? machine.id);
				for (const [index, result] of results.entries()) {
					if (result.status === "rejected") {
						const machine = connected[index];
						if (machine) unavailable.push(machine.label ?? machine.id);
						continue;
					}
					const { machine, paths } = result.value;
					if (
						!Array.isArray(paths) ||
						paths.some((path) => typeof path !== "string" || !path)
					)
						throw new Error("Saved session lookup returned invalid locations");
					for (const sessionFile of paths)
						locations.push({ machine, sessionFile });
				}
				// A missing peer cannot veto candidates elsewhere; Notes verifies them.
				// Without candidates, report incomplete discovery rather than absence.
				if (!locations.length && unavailable.length)
					throw Object.assign(
						new Error(
							`Saved sessions could not be searched on ${unavailable.join(", ")}. Reconnect those machines and check access to their Pi session storage, then retry.`,
						),
						{ code: "SAVED_SESSION_UNAVAILABLE" },
					);
				return locations;
			},
		},
	);
}
