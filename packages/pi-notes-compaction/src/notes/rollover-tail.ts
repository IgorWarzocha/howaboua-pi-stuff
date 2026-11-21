import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	sessionEntryToContextMessages,
	type ExtensionContext,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { lastSavedGroup, NOTES_RUN_ENTRY } from "./fresh-notes.js";
import { NOTE_RECEIPT } from "./notes.js";
import type { RolloverTailMode } from "./settings.js";
import { isWindowCheckpoint } from "./window-checkpoint.js";
import {
	messageWindowDetails,
	SETTLEMENT_ENTRY,
	windowDetails,
} from "./window-message.js";

export interface RolloverTail {
	mode: Exclude<RolloverTailMode, "off">;
	firstKeptEntryId: string;
	firstMessage: string;
}

export function tailMessageKey(message: AgentMessage): string {
	return JSON.stringify([
		message.role,
		message.timestamp,
		message.role === "custom"
			? message.customType
			: message.role === "assistant"
				? message.content.find((block) => block.type === "toolCall")?.id
				: undefined,
	]);
}

export function projectTailMessage(
	message: AgentMessage,
	mode: RolloverTail["mode"],
	completeCalls?: ReadonlySet<string>,
): AgentMessage | undefined {
	// The successor's window carrier is outside this tail. Never replay
	// outgoing identity or checkpoint reminders as conversation.
	if (message.role === "custom")
		return mode === "full" &&
			!messageWindowDetails(message.customType, message.details)
			? message
			: undefined;
	if (mode === "full") {
		if (message.role === "toolResult")
			return completeCalls?.has(message.toolCallId) ? message : undefined;
		if (
			message.role !== "assistant" ||
			message.content.every(
				(part) => part.type !== "toolCall" || completeCalls?.has(part.id),
			)
		)
			return message;
		// An unfinished call group is not portable; its user-visible text is.
	}
	if (message.role === "user") return message;
	if (message.role !== "assistant") return;
	const content = message.content.filter((part) => part.type === "text");
	if (content.length)
		return content.length === message.content.length
			? message
			: { ...message, content, stopReason: "stop" };
}

export function completeTailCalls(
	messages: Iterable<AgentMessage>,
): ReadonlySet<string> {
	const complete = new Set<string>();
	const group = new Map<string, string>();
	const seen = new Set<string>();
	const finish = () => {
		if (group.size === seen.size) for (const id of seen) complete.add(id);
		seen.clear();
		group.clear();
	};
	for (const message of messages) {
		if (message.role === "assistant") {
			finish();
			for (const call of message.content)
				if (call.type === "toolCall") group.set(call.id, call.name);
		} else if (message.role === "toolResult") {
			if (group.get(message.toolCallId) === message.toolName)
				seen.add(message.toolCallId);
		} else if (message.role === "user" || message.role === "custom") {
			finish();
		}
	}
	finish();
	return complete;
}

export function projectTailEntry(
	entry: SessionEntry,
	mode: RolloverTail["mode"],
	completeCalls?: ReadonlySet<string>,
): SessionEntry {
	if (
		entry.type !== "message" &&
		entry.type !== "custom_message" &&
		entry.type !== "branch_summary"
	)
		return entry;
	const original = sessionEntryToContextMessages(entry)[0];
	if (!original) return entry;
	const message = projectTailMessage(original, mode, completeCalls);
	if (message === original) return entry;
	if (message?.role === "assistant")
		return { ...entry, type: "message", message };
	// Structural IDs are still needed for the native cut and context edits.
	const { id, parentId, timestamp } = entry;
	return {
		id,
		parentId,
		timestamp,
		type: "custom",
		customType: "notes-compaction:retired-tail-item",
	};
}

export function* branchBackwards(manager: ExtensionContext["sessionManager"]) {
	for (let entry = manager.getLeafEntry(); entry;) {
		yield entry;
		entry = entry.parentId ? manager.getEntry(entry.parentId) : undefined;
	}
}

export function readSettlement(entry: SessionEntry, windowId: string) {
	if (entry.type !== "custom" || entry.customType !== SETTLEMENT_ENTRY) return;
	const data = entry.data;
	if (
		data &&
		typeof data === "object" &&
		"windowId" in data &&
		data.windowId === windowId &&
		"aborted" in data &&
		data.aborted === false &&
		"completedEntryId" in data &&
		typeof data.completedEntryId === "string" &&
		"settledAt" in data &&
		typeof data.settledAt === "number" &&
		Number.isFinite(data.settledAt)
	)
		return {
			completedEntryId: data.completedEntryId,
			settledAt: data.settledAt,
		};
}

function runMarker(entry: SessionEntry): string | undefined {
	if (entry.type !== "custom" || entry.customType !== NOTES_RUN_ENTRY) return;
	const data = entry.data;
	if (
		data &&
		typeof data === "object" &&
		"runId" in data &&
		typeof data.runId === "string"
	)
		return data.runId;
}

export function currentRun(
	manager: ExtensionContext["sessionManager"],
	runId: string,
) {
	const run: SessionEntry[] = [];
	for (const entry of branchBackwards(manager)) {
		run.push(entry);
		const marker = runMarker(entry);
		if (marker) return marker === runId ? run.reverse() : undefined;
	}
}

function savedGroup(
	run: readonly SessionEntry[],
	windowId: string,
	runId: string,
	terminal: SessionEntry,
) {
	if (
		terminal.type !== "message" ||
		terminal.message.role !== "assistant" ||
		terminal.message.stopReason !== "stop" ||
		terminal.message.content.some((part) => part.type === "toolCall") ||
		!run.some(
			(entry) => entry.type === "custom" && entry.customType === NOTE_RECEIPT,
		)
	)
		return;
	const first = lastSavedGroup(run, windowId, runId);
	const message = first && sessionEntryToContextMessages(first)[0];
	if (first && message)
		return {
			firstKeptEntryId: first.id,
			firstMessage: tailMessageKey(message),
		};
}

/** Inspect only current-branch parents, stopping at the newest proven save or a retirement cut. */
export function findRolloverTail(
	manager: ExtensionContext["sessionManager"],
	windowId: string,
	mode: RolloverTail["mode"],
): RolloverTail | undefined {
	let run: SessionEntry[] = [];
	let settlement: ReturnType<typeof readSettlement>;
	let terminal: SessionEntry | undefined;
	let cut = false;
	for (const entry of branchBackwards(manager)) {
		if (
			windowDetails(entry)?.trim ||
			(entry.type === "compaction" && !isWindowCheckpoint(entry))
		) {
			if (!terminal || cut) break;
			// A rollover kickoff or overflow can follow the run marker.
			// Find only that marker behind the cut, not any older proof.
			cut = true;
		}
		const runId = runMarker(entry);
		if (runId) {
			const group =
				terminal && savedGroup(run.reverse(), windowId, runId, terminal);
			if (group) return { mode, ...group };
			if (cut) break;
			run = [];
			settlement = terminal = undefined;
		} else if (!cut) {
			settlement ??= readSettlement(entry, windowId);
			if (settlement && entry.id === settlement.completedEntryId)
				terminal = entry;
			if (terminal) run.push(entry);
		}
	}
}
