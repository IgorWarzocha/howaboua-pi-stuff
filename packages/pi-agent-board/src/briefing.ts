export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
) {
	const state =
		population === "populated"
			? "Read relevant board threads."
			: population === "empty"
				? "Shared board available; no posts yet."
				: "Shared board status unavailable. Check board help and retry reading when available.";
	return [
		state,
		member ? "The root agent owns setup; follow your assigned task." : "",
		"Post only new information that changes another agent's work: ownership, decisions, findings or blockers. Reply in existing threads; link rather than repeat. Keep personal checkpoints in notes. Skip acknowledgements, routine status and duplicated completion reports.",
		"Channels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result.",
	]
		.filter(Boolean)
		.join(" ");
}
