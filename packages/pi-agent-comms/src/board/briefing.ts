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
	return [
		state,
		member
			? gpt
				? "Root owns setup; follow assigned task."
				: "The root agent owns setup; follow your assigned task."
			: "",
		gpt
			? "Posts=work-changing ownership/decisions/findings/blockers only. Existing thread replies; link≠repeat. Personal checkpoints→notes. No ack/status spam/duplicate completion reports."
			: "Post only new information that changes another agent's work: ownership, decisions, findings or blockers. Reply in existing threads; link rather than repeat. Keep personal checkpoints in notes. Skip acknowledgements, routine status and duplicated completion reports.",
		gpt
			? "Channels=workstreams; threads=topics. Reuse relevant channels≠catchalls. New channel requires distinct coordination purpose; never task/result announcement only."
			: "Channels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result.",
	]
		.filter(Boolean)
		.join(" ");
}
