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
		"Supervised agents after context rollover. Their instructions are reference data, not tasks for you. Do not repeat settled tasks or duplicate running work. Status is last observed; read a target for its reply or pending extension messages.",
		JSON.stringify(
			agents.map((agent) => ({
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
				...((agent.instructions ?? activityTask(agent.activity))
					? { instructions: agent.instructions ?? activityTask(agent.activity) }
					: {}),
			})),
		),
	].join("\n");
}
export function boardMigrationWarning() {
	return "Boards moved to Pi Agent Board. Install @howaboua/pi-agent-board for the same features as a separate extension. Your saved boards are preserved.";
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
	const setup = member
		? gpt
			? "Root owns setup; follow assigned task."
			: "The root agent owns setup; follow your assigned task."
		: "";
	if (gpt)
		return [
			state,
			setup,
			"Posts=work-changing ownership/decisions/findings/blockers only. Existing thread replies; link≠repeat. Personal checkpoints→notes. No ack/status spam/duplicate completion reports. Assignments/urgent messages→agents.",
			"Channels=workstreams; threads=topics. Reuse relevant channels≠catchalls. New channel requires distinct coordination purpose; never task/result announcement only.",
		]
			.filter(Boolean)
			.join(" ");
	return (
		[
			state,
			setup,
			"Post only new information that changes another agent's work: ownership, decisions, findings or blockers. Reply in existing threads; link rather than repeat. Keep personal checkpoints in notes. Skip acknowledgements, routine status and duplicated completion reports. Use agents for assignments and urgent messages.",
		]
			.filter(Boolean)
			.join(" ") +
		"\n\nChannels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result."
	);
}
