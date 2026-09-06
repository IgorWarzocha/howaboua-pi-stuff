import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { CODEX_REASONING_UPDATE_TYPE, readCodexReasoningUpdate } from "./reasoning-updates.ts";

export function projectCodexReasoningEntry(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_REASONING_UPDATE_TYPE) return entry;
	const update = readCodexReasoningUpdate(entry.data);
	return { ...entry, type: "custom_message", content: `Reasoning effort: ${update.effort}`, display: false, details: update };
}

/** Rehydrate bookkeeping only in model context; leave Pi's tree and stored entries intact. */
export function projectCodexReasoningHistory(
	entries: readonly SessionEntry[],
	messages?: readonly AgentMessage[],
	leafId?: string | null,
): AgentMessage[] {
	const virtualIds = new Set<string>();
	const projectedEntries = entries.map((entry): SessionEntry => {
		const projected = projectCodexReasoningEntry(entry);
		if (projected !== entry && projected.type === "custom_message") virtualIds.add(readCodexReasoningUpdate(projected.details).id);
		return projected;
	});
	if (messages && virtualIds.size === 0) return [...messages];
	const reconstructed = buildSessionContext(projectedEntries, leafId).messages;
	if (!messages) return reconstructed;
	// Preserve other extensions' message edits and additions. Insert metadata at its
	// persisted position, before the next surviving message or after the final one.
	const positions = new Map<string, number[]>();
	messages.forEach((message, index) => {
		const key = messageKey(message);
		const indices = positions.get(key) ?? [];
		indices.push(index);
		positions.set(key, indices);
	});
	const insertions = new Map<number, AgentMessage[]>();
	let pending: AgentMessage[] = [];
	let last = -1;
	for (const message of reconstructed) {
		const index = positions.get(messageKey(message))?.shift();
		if (index !== undefined) {
			if (pending.length) insertions.set(index, [...(insertions.get(index) ?? []), ...pending]);
			pending = [];
			last = index;
		} else if (message.role === "custom" && message.customType === CODEX_REASONING_UPDATE_TYPE
			&& virtualIds.has(readCodexReasoningUpdate(message.details).id)) pending.push(message);
	}
	if (pending.length) insertions.set(last + 1, [...(insertions.get(last + 1) ?? []), ...pending]);
	return messages.flatMap((message, index) => [...(insertions.get(index) ?? []), message])
		.concat(insertions.get(messages.length) ?? []);
}

function messageKey(message: AgentMessage): string {
	return JSON.stringify([message.role, message.timestamp,
		message.role === "custom" ? (message.customType === CODEX_REASONING_UPDATE_TYPE
			? readCodexReasoningUpdate(message.details).id : message.customType)
			: message.role === "toolResult" ? message.toolCallId : undefined]);
}
