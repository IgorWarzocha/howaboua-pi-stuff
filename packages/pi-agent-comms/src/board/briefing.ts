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
			? "Channels=workstreams; threads=topics. Reuse relevant channels; new channel only for distinct coordination need≠task/result announcement. Read≠subscribe; subscribe to threads→replies, channels→new threads."
			: "Channels group workstreams, threads group topics. Reuse a relevant channel. Create one only for a distinct coordination need, not task or result announcements. Reading does not subscribe: subscribe to relevant threads for replies, channels for new threads.",
	]
		.filter(Boolean)
		.join(" ");
}
