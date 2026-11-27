import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { WINDOW_MESSAGE } from "./window-message.js";

type GuidanceEntry = Extract<SessionEntry, { type: "custom_message" }>;
type PrefixSourceEntry =
	| Extract<SessionEntry, { type: "custom" }>
	| GuidanceEntry;
const DEVELOPER_KEY = "@howaboua/pi-codex-conversion/developer-message";

/** Only existing developer carriers carry prior guidance; custom user input is conversation. */
export function isPrefixGuidanceEntry(
	entry: SessionEntry,
): entry is GuidanceEntry {
	if (
		entry.type !== "custom_message" ||
		entry.customType === WINDOW_MESSAGE ||
		typeof entry.content !== "string" ||
		!entry.details ||
		typeof entry.details !== "object"
	)
		return false;
	const marker =
		entry.customType === "codex-developer-message"
			? entry.details
			: DEVELOPER_KEY in entry.details
				? entry.details[DEVELOPER_KEY]
				: undefined;
	return Boolean(
		marker &&
		typeof marker === "object" &&
		"protocol" in marker &&
		marker.protocol === 1 &&
		"id" in marker &&
		typeof marker.id === "string" &&
		marker.id.trim(),
	);
}

/** Resolve immutable source entries, honoring any explicit later context edit. */
export function resolvePrefixGuidance(
	entries: readonly SessionEntry[],
	ids: readonly string[],
	kickoff: string,
): PrefixSourceEntry[] | undefined {
	const needed = new Set(ids);
	const found = new Map<string, PrefixSourceEntry>();
	const edits = new Map<
		string,
		Extract<SessionEntry, { type: "context_edit" }>
	>();
	let beforeKickoff = true;
	for (const entry of entries) {
		if (entry.id === kickoff) beforeKickoff = false;
		if (
			beforeKickoff &&
			needed.has(entry.id) &&
			(entry.type === "custom" || isPrefixGuidanceEntry(entry))
		) {
			if (ids[found.size] !== entry.id) return;
			found.set(entry.id, entry);
		} else if (entry.type === "context_edit" && needed.has(entry.targetId))
			edits.set(entry.targetId, entry);
	}
	if (beforeKickoff || found.size !== needed.size) return;
	return ids.flatMap((id) => {
		const entry = found.get(id)!;
		const edit = edits.get(id);
		if (!edit || entry.type === "custom") return [entry];
		const content = edit.replacement?.content;
		if (typeof content === "string") return [{ ...entry, content }];
		return content
			? [
					{
						...entry,
						content: content.filter(
							(part) => part.type === "text" || part.type === "image",
						),
					},
				]
			: [];
	});
}
