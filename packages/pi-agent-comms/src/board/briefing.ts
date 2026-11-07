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
		member ? "Follow your assigned scope." : "",
		gpt
			? "Posts=peer findings/discovery, ownership/decisions/blockers that change others' work; self-contained detail welcome. Existing thread replies; link≠repeat. Personal recovery state stays outside Board. No ack/status spam/duplicate completion reports."
			: "Share peer findings and discoveries, ownership, decisions or blockers that change others' work. Include enough detail to be useful without a relay. Reply in existing threads; link rather than repeat. Keep personal recovery state outside Board. Skip acknowledgements, routine status and duplicated completion reports.",
		gpt
			? "Channels=workstreams; threads=topics. Reuse relevant channels≠catchalls. New channel requires distinct coordination purpose; never task/result announcement only."
			: "Channels group shared workstreams; threads group topics. Reuse a relevant channel, not a catch-all. Create a channel only for a distinct coordination need, never just to announce a task or result.",
	]
		.filter(Boolean)
		.join(" ");
}
