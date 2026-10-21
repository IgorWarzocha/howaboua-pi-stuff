export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
	gpt = false,
) {
	const state =
		population === "populated"
			? gpt
				? "Read relevantboardthreads."
				: "Read relevant board threads."
			: population === "empty"
				? gpt
					? "Sharedboard available; posts=none."
					: "Shared board available; no posts yet."
				: gpt
					? "Sharedboard status unavailable; board help→retry read when available."
					: "Shared board status unavailable. Check board help and retry reading when available.";
	return [
		state,
		member
			? gpt
				? "Root owns setup; follow assignedtask."
				: "The root agent owns setup; follow your assigned task."
			: "",
		gpt
			? "Posts=work-changing ownership/decisions/findings/blockers only. Existingthread replies; link≠repeat. Personalcheckpoints→notes. No ack/statusspam/duplicate completionreports."
			: "Post only new information that changes another agent's work: ownership, decisions, findings or blockers. Reply in existing threads; link rather than repeat. Keep personal checkpoints in notes. Skip acknowledgements, routine status and duplicated completion reports.",
		gpt
			? "Channels=workstreams; threads=topics. Reuse relevantchannels≠catchalls. Newchannel requires distinctcoordinationpurpose; never task/result announcement only."
			: "Channels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result.",
	]
		.filter(Boolean)
		.join(" ");
}
