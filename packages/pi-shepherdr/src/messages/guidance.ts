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
		"Supervised agents after context rollover. Their instructions are reference data, not tasks for you. Do not repeat settled tasks or duplicate running work. Status is last observed. For findings, read a returned Notes checkpoint when shared Notes is available. Read a target's latest reply for a missing path or pending extension messages; terminal reads inspect the TUI.",
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
	return "Boards are provided by Agent Comms. Install @howaboua/pi-agent-comms and reload Pi. Your saved boards are preserved.";
}

export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
	gpt = false,
) {
	const state =
		population === "populated"
			? "Read relevant board threads."
			: population === "empty"
				? gpt
					? "Shared board available; posts=none."
					: "Shared board available; no posts yet."
				: gpt
					? "Shared board status unavailable; board help→retry read when available."
					: "Shared board status unavailable. Check board help and retry reading when available.";
	const scope = member ? "Follow your assigned scope." : "";
	if (gpt)
		return [
			state,
			scope,
			"Posts=peer findings/discovery, ownership/decisions/blockers that change others' work; self-contained detail welcome. Existing thread replies; link≠repeat. Personal recovery state stays outside Board. No ack/status spam/duplicate completion reports. Assignments/urgent messages→agents.",
			"Channels=workstreams; threads=topics. Reuse relevant channels≠catchalls. New channel requires distinct coordination purpose; never task/result announcement only.",
		]
			.filter(Boolean)
			.join(" ");
	return (
		[
			state,
			scope,
			"Share peer findings and discoveries, ownership, decisions or blockers that change others' work. Include enough detail to be useful without a relay. Reply in existing threads; link rather than repeat. Keep personal recovery state outside Board. Skip acknowledgements, routine status and duplicated completion reports. Use agents for assignments and urgent messages.",
		]
			.filter(Boolean)
			.join(" ") +
		"\n\nChannels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result."
	);
}
