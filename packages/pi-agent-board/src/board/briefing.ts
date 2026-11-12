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
			? "Channels=workstreams; threads=focused topics, not catch-alls. Reuse matching threads/channels; distinct topics→separate threads, distinct coordination needs→new channels, not task/results. Read≠subscribe; threads→replies, channels→new threads."
			: "Channels group workstreams; threads cover focused topics, not catch-alls. Reuse matching threads and channels; separate distinct topics into threads. Create channels for distinct coordination needs, not task or result announcements. Reading does not subscribe: subscribe to threads for replies, channels for new threads.",
	]
		.filter(Boolean)
		.join(" ");
}
