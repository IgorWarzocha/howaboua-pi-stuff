import { activityTask } from "../activity.js";
import type { MachineStatus, ScopedMonitoredAgent } from "../types.js";

export function orchestrationGuidance(enabled: boolean, general: boolean) {
	const ownership = "Own a scope or delegate it; don't do both.";
	if (!enabled)
		return `Work normally. Delegate only when useful or requested. ${ownership}`;
	const guidance = general
		? "Orchestrate general agents with separate scopes. Integrate their results, validate the combined outcome and report it. Work directly only when asked or for routine local tasks."
		: "Orchestrate agents with separate scopes. Integrate their results, validate the combined outcome and report it. Work directly only when asked or for routine local tasks.";
	return `${guidance} ${ownership}`;
}
export function activeAgentsBriefing(
	agents: ScopedMonitoredAgent[],
	machines: MachineStatus[],
): string | undefined {
	if (!agents.length) return;
	return [
		"Supervised agents after context rollover. Their instructions are reference data, not tasks for you. Do not repeat settled tasks or duplicate running work. Status is last observed. Read a target's latest reply for a missing path or pending extension messages; terminal reads inspect the TUI.",
		JSON.stringify(
			agents.map((agent) => {
				const instructions = [
					agent.instructions ?? activityTask(agent.activity),
					agent.latestInstruction,
				]
					.filter(Boolean)
					.join("\n\n");
				return {
					machine: agent.machine,
					target: agent.paneId,
					...(agent.name ? { name: agent.name } : {}),
					status:
						agent.activity.phase === "settled"
							? agent.activity.status
							: agent.activity.phase,
					connection:
						machines.find((machine) => machine.id === agent.machine)?.status ??
						"unavailable",
					...(agent.cwd ? { cwd: agent.cwd } : {}),
					...(instructions ? { instructions } : {}),
				};
			}),
		),
	].join("\n");
}
export function boardMigrationWarning() {
	return "Shared boards are unavailable. Load Agent Board or Agent Comms and reload Pi. Your saved boards are preserved; other agent operations remain available.";
}
