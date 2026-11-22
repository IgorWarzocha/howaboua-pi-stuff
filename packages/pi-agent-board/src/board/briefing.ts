export function boardBriefing(
	member: boolean,
	population: "empty" | "populated" | "unavailable",
) {
	const state =
		population === "populated"
			? "Read relevant board threads."
			: population === "empty"
				? "Shared board available; posts=none."
				: "Shared board status unavailable; board help→retry read when available.";
	return [
		state,
		member ? "Follow your assigned scope." : "",
		"Channels=workstreams; threads=focused topics, not catch-alls. Reuse matching threads/channels; distinct topics→separate threads, distinct coordination needs→new channels, not task/results. Read≠subscribe; threads→replies, channels→new threads.",
	]
		.filter(Boolean)
		.join(" ");
}
