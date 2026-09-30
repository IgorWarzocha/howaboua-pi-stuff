import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { buildTreeArchiveIndex, hasTreeArchiveSuccessor, TREE_ARCHIVE_ENTRY_TYPE } from "./tree-archive.ts";
import { CODEX_CONTEXT_WINDOW_MESSAGE_TYPE, isCodexContextManagementMessageDetails } from "./messages.ts";

/** Restore the archived checkpoint's source path only in model/replay context. */
export function projectTreeCheckpointBranch(
	active: readonly SessionEntry[],
	all: readonly SessionEntry[],
): readonly SessionEntry[] {
	const index = buildTreeArchiveIndex(all, active);
	const hiddenSummaries = new Set(index.archives.filter((item) =>
		!item.manifest.compactionEntryId || hasTreeArchiveSuccessor(active, item.manifest.windowId))
		.map((item) => item.summary.id));
	const manifestIndex = active.findLastIndex((entry) => entry.type === "custom" && entry.customType === TREE_ARCHIVE_ENTRY_TYPE);
	if (manifestIndex < 0) return hideArchiveSummaries(active, hiddenSummaries);
	const tail = active.slice(manifestIndex + 1);
	// Validate only the archive the live checkpoint still needs, not retired history.
	if (tail.some((entry) => entry.type === "compaction" || (entry.type === "custom_message" &&
		entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE && isCodexContextManagementMessageDetails(entry.details) &&
		entry.details.contextManagement.kind === "window" && entry.details.contextManagement.trimPreviousWindow)))
		return hideArchiveSummaries(active, hiddenSummaries);
	const archive = index.archives.find((item) => item.summary.id === active[manifestIndex]!.parentId);
	if (!archive) throw new Error("Invalid active Tree archive checkpoint metadata");
	if (!archive.manifest.compactionEntryId || !hasTreeArchiveSuccessor(active, archive.manifest.windowId))
		return hideArchiveSummaries(active, hiddenSummaries);
	if (!archive.entries) throw new Error("The active Tree checkpoint is unavailable in this session copy; resume the source session");
	const byId = new Map(all.map((entry) => [entry.id, entry]));
	const source: SessionEntry[] = [];
	const visited = new Set<string>();
	let id: string | null = archive.manifest.archivedLeafId;
	while (id !== null) {
		if (visited.has(id) || source.length >= 50_000) throw new Error("Invalid Tree checkpoint ancestry");
		visited.add(id);
		const entry = byId.get(id);
		if (!entry) throw new Error("Tree checkpoint ancestry is missing");
		source.push(entry);
		id = entry.parentId;
	}
	source.reverse();
	const checkpointIndex = source.findIndex((entry) => entry.id === archive.manifest.compactionEntryId);
	const checkpoint = source[checkpointIndex];
	if (checkpoint?.type !== "compaction" ||
		!source.slice(0, checkpointIndex).some((entry) => entry.id === checkpoint.firstKeptEntryId))
		throw new Error("Tree checkpoint kept history is missing");
	return hideArchiveSummaries([...source, ...tail].map((entry, position, entries): SessionEntry => {
		const parentId = position === 0 ? null : entries[position - 1]!.id;
		return entry.parentId === parentId ? entry : { ...entry, parentId };
	}), hiddenSummaries);
}

function hideArchiveSummaries(entries: readonly SessionEntry[], hidden: ReadonlySet<string>): readonly SessionEntry[] {
	if (hidden.size === 0) return entries;
	return entries.map((entry): SessionEntry => entry.type === "branch_summary" && hidden.has(entry.id)
		// Keep entry IDs as replay cut points without sending archive summaries.
		? { type: "custom", id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp,
			customType: "codex-context-tree-summary", data: {} } : entry);
}

/** Replace only persisted context displaced by the archive; retain extension edits/additions. */
export function projectTreeCheckpointMessages(
	active: readonly SessionEntry[],
	projected: readonly SessionEntry[],
	messages: readonly AgentMessage[] | undefined,
): readonly AgentMessage[] | undefined {
	if (!messages || active === projected) return messages;
	const original = new Set(buildSessionContext([...active]).messages.map(messageKey));
	const reconstructed = buildSessionContext([...projected]).messages;
	const desired = new Set(reconstructed.map(messageKey));
	const retained = messages.filter((message) => !original.has(messageKey(message)) || desired.has(messageKey(message)));
	const positions = new Map<string, number[]>();
	retained.forEach((message, index) => {
		const key = messageKey(message);
		positions.set(key, [...(positions.get(key) ?? []), index]);
	});
	const insertions = new Map<number, AgentMessage[]>();
	let pending: AgentMessage[] = [];
	let last = -1;
	for (const message of reconstructed) {
		const key = messageKey(message);
		const position = positions.get(key)?.shift();
		if (position !== undefined) {
			if (pending.length) insertions.set(position, [...(insertions.get(position) ?? []), ...pending]);
			pending = [];
			last = position;
		} else if (!original.has(key)) pending.push(message);
	}
	if (pending.length) insertions.set(last + 1, [...(insertions.get(last + 1) ?? []), ...pending]);
	return retained.flatMap((message, index) => [...(insertions.get(index) ?? []), message])
		.concat(insertions.get(retained.length) ?? []);
}

function messageKey(message: AgentMessage): string {
	return JSON.stringify([message.role, message.timestamp,
		message.role === "custom" ? message.customType :
			message.role === "toolResult" ? message.toolCallId :
				message.role === "branchSummary" ? message.fromId : undefined]);
}
