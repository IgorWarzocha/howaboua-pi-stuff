import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { CODEX_REASONING_UPDATE_TYPE, readCodexReasoningUpdate } from "./reasoning-updates.ts";
import { CODEX_CURRENT_TIME_REMINDER_TYPE, projectCurrentTimeReminder } from "./current-time-reminder.ts";
import { isCodexDeveloperMessageDetails } from "../developer-messages.ts";

export function projectCodexDeveloperEntry(entry: SessionEntry): SessionEntry {
	if (entry.type !== "custom" || entry.customType !== CODEX_REASONING_UPDATE_TYPE) return projectCurrentTimeReminder(entry);
	const update = readCodexReasoningUpdate(entry.data);
	return { ...entry, type: "custom_message", content: `Reasoning effort: ${update.effort}`, display: false, details: update };
}

/** Rehydrate bookkeeping only in model context; leave Pi's tree and stored entries intact. */
export function projectCodexDeveloperHistory(
	entries: readonly SessionEntry[],
	messages?: readonly AgentMessage[],
	leafId?: string | null,
): AgentMessage[] {
	const retired = new Set<string>();
	const byId = new Map(entries.map((entry) => [entry.id, entry]));
	let ancestor = leafId === null ? undefined : leafId ? byId.get(leafId) : entries.at(-1);
	let compacted = false;
	while (ancestor) {
		if (ancestor.type === "compaction") compacted = true;
		if (compacted && (ancestor.type === "custom" || ancestor.type === "custom_message") && ancestor.customType === CODEX_REASONING_UPDATE_TYPE)
			retired.add(readCodexReasoningUpdate(ancestor.type === "custom" ? ancestor.data : ancestor.details).id);
		ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
	}
	const survives = (message: AgentMessage) => message.role !== "custom" || message.customType !== CODEX_REASONING_UPDATE_TYPE
		|| !retired.has(readCodexReasoningUpdate(message.details).id);
	// Pi can retain pre-compaction messages. Retire only their reasoning bookkeeping,
	// without changing saved entries or another extension's message transformations.
	messages = messages?.filter(survives);
	const virtualIds = new Set<string>();
	const projectedEntries = entries.map((entry): SessionEntry => {
		const projected = projectCodexDeveloperEntry(entry);
		if (projected !== entry && projected.type === "custom_message" && isCodexDeveloperMessageDetails(projected.details)
			&& !retired.has(projected.details.id)) virtualIds.add(projected.details.id);
		return projected;
	});
	if (messages && virtualIds.size === 0) return [...messages];
	const reconstructed = buildSessionContext(projectedEntries, leafId).messages.filter(survives);
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
	const leadingSystem = messages[0]?.role === "system";
	const insertPending = (index: number) => {
		if (!pending.length) return;
		// Pi reads the prompt and initial tools from index 0, even when bookkeeping predates that system entry.
		const position = leadingSystem && index === 0 ? 1 : index;
		insertions.set(position, [...(insertions.get(position) ?? []), ...pending]);
		pending = [];
	};
	let last = -1;
	for (const message of reconstructed) {
		const index = positions.get(messageKey(message))?.shift();
		if (index !== undefined) {
			insertPending(index);
			last = index;
		} else if (isVirtualMessage(message) && isCodexDeveloperMessageDetails(message.details)
			&& virtualIds.has(message.details.id)) pending.push(message);
	}
	insertPending(last + 1);
	return messages.flatMap((message, index) => [...(insertions.get(index) ?? []), message])
		.concat(insertions.get(messages.length) ?? []);
}

function messageKey(message: AgentMessage): string {
	return JSON.stringify([message.role, message.timestamp,
		message.role === "custom" ? (isVirtualMessage(message) && isCodexDeveloperMessageDetails(message.details)
			? message.details.id : message.customType)
			: message.role === "toolResult" ? message.toolCallId : undefined]);
}

function isVirtualMessage(message: AgentMessage): message is Extract<AgentMessage, { role: "custom" }> {
	return message.role === "custom" && (message.customType === CODEX_REASONING_UPDATE_TYPE
		|| message.customType === CODEX_CURRENT_TIME_REMINDER_TYPE);
}
