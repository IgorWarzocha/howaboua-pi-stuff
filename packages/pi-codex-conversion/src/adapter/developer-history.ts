import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, type SessionEntry } from "@earendil-works/pi-coding-agent";
import { CODEX_REASONING_UPDATE_TYPE, readCodexReasoningUpdate } from "./reasoning-updates.ts";
import { CODEX_CURRENT_TIME_REMINDER_TYPE, projectCurrentTimeReminder } from "./current-time-reminder.ts";
import { isCodexDeveloperMessageDetails } from "../developer-messages.ts";
import { CODEX_TOOLKIT_UPDATE_TYPE, projectToolkitUpdate } from "./code-mode/toolkit-updates.ts";
import { CODEX_NOTEBOOK_STATUS_TYPE, projectNotebookStatusEntry } from "./notebook-status.ts";
import { CODEX_CONTEXT_BRIEFING_TYPE, projectCodexContextBriefing } from "../context-briefings.ts";

export function projectCodexDeveloperEntry(entry: SessionEntry): SessionEntry {
	if (entry.type === "custom" && entry.customType === CODEX_CONTEXT_BRIEFING_TYPE) return projectCodexContextBriefing(entry);
	if (entry.type === "custom" && entry.customType === CODEX_NOTEBOOK_STATUS_TYPE) return projectNotebookStatusEntry(entry);
	if (entry.type === "custom" && entry.customType === CODEX_TOOLKIT_UPDATE_TYPE) return projectToolkitUpdate(entry);
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
	const survives = (message: AgentMessage) => message.role !== "custom" || message.customType !== CODEX_REASONING_UPDATE_TYPE
		|| !retired.has(readCodexReasoningUpdate(message.details).id);
	// Without projected metadata or persisted reasoning updates, supplied messages
	// need neither reconstruction nor compaction retirement. Do not cache their edits.
	if (messages && !entries.some((entry) =>
		(entry.type === "custom" && isVirtualCustomType(entry.customType))
		|| (entry.type === "custom_message" && entry.customType === CODEX_REASONING_UPDATE_TYPE))) return messages.filter(survives);
	const byId = new Map<string, SessionEntry>();
	for (const entry of entries) byId.set(entry.id, entry);
	let ancestor = leafId === null ? undefined : leafId ? byId.get(leafId) : entries.at(-1);
	let compacted = false;
	while (ancestor) {
		if (ancestor.type === "compaction") compacted = true;
		if (compacted && (ancestor.type === "custom" || ancestor.type === "custom_message") && ancestor.customType === CODEX_REASONING_UPDATE_TYPE)
			retired.add(readCodexReasoningUpdate(ancestor.type === "custom" ? ancestor.data : ancestor.details).id);
		ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined;
	}
	// Pi can retain pre-compaction messages. Retire only their reasoning bookkeeping,
	// without changing saved entries or another extension's message transformations.
	messages = messages?.filter(survives);
	const virtualIds = new Set<string>();
	const projectedEntries = entries.map((entry): SessionEntry => {
		const projected = projectCodexDeveloperEntry(entry);
		byId.set(projected.id, projected);
		if (projected !== entry && projected.type === "custom_message" && isCodexDeveloperMessageDetails(projected.details)
			&& !retired.has(projected.details.id)) virtualIds.add(projected.details.id);
		return projected;
	});
	if (messages && virtualIds.size === 0) return [...messages];
	// The SDK traverses the same index twice. Reuse this operation's index, now
	// pointing at projected entries, rather than rebuilding it for each traversal.
	const reconstructed = buildSessionContext(projectedEntries, leafId, byId).messages.filter(survives);
	// Pi's initial prompt must lead the transcript; only virtual bookkeeping may precede it in storage.
	const headSystemIndex = reconstructed.findIndex((message) => message.role === "system");
	if (headSystemIndex > 0 && reconstructed.slice(0, headSystemIndex).every(isVirtualMessage)) {
		reconstructed.unshift(...reconstructed.splice(headSystemIndex, 1));
	}
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
	const firstConversation = reconstructed.find(message => message.role !== "system" && !isVirtualMessage(message));
	let anchorSurvives = !firstConversation || positions.has(messageKey(firstConversation));
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
			if (message.role !== "system" && !isVirtualMessage(message)) anchorSurvives = true;
		} else if (isVirtualMessage(message) && isCodexDeveloperMessageDetails(message.details)
			&& virtualIds.has(message.details.id)) {
			if (anchorSurvives) pending.push(message);
		} else if (message.role !== "system") {
			// Bookkeeping follows its conversation, not raw JSONL. A context filter
			// that removed that span must not have its old notices reinserted here.
			anchorSurvives = false;
			pending = [];
		}
	}
	insertPending(last + 1);
	const result: AgentMessage[] = [];
	for (let index = 0; index < messages.length; index++) {
		const inserted = insertions.get(index);
		if (inserted) for (const message of inserted) result.push(message);
		result.push(messages[index]!);
	}
	for (const message of insertions.get(messages.length) ?? []) result.push(message);
	return result;
}

function messageKey(message: AgentMessage): string {
	return JSON.stringify([message.role, message.timestamp,
		message.role === "custom" ? (isVirtualMessage(message) && isCodexDeveloperMessageDetails(message.details)
			? message.details.id : message.customType)
			: message.role === "toolResult" ? message.toolCallId : undefined]);
}

function isVirtualMessage(message: AgentMessage): message is Extract<AgentMessage, { role: "custom" }> {
	return message.role === "custom" && isVirtualCustomType(message.customType);
}

function isVirtualCustomType(customType: string): boolean {
	return customType === CODEX_REASONING_UPDATE_TYPE || customType === CODEX_CONTEXT_BRIEFING_TYPE
		|| customType === CODEX_CURRENT_TIME_REMINDER_TYPE || customType === CODEX_TOOLKIT_UPDATE_TYPE
		|| customType === CODEX_NOTEBOOK_STATUS_TYPE;
}
