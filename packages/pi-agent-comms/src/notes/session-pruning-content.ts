import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { windowDetails } from "./windows.js";

const PRUNED_ENTRY = "notes-compaction:pruned:v1";
const PROMPT_STATE = new Set([
	"codex-toolkit-update",
	"codex-current-time-reminder",
	"codex-notebook-status",
	"codex-reasoning-update",
	"codex-context-briefing",
	"codex-remote-delivery",
	"codex-context-idle-checkpoint",
	"codex-note-save-marker",
	"notes-compaction:settled:v1",
	"notes-compaction:run:v1",
	"notes-compaction:nested-write:v1",
	"notes-compaction:continuation",
]);
const KNOWN_STATE = new Set([
	"codex-context-agent",
	"codex-context-backend",
	"codex-agent-relationship",
	"notes-compaction:note:v1",
	"notes-compaction:cache:v1",
	"codex-context-note",
	"codex-context-note-snapshot",
	"pi-codex-conversion-notebook-tree-epoch",
	"herdr-context-child",
	"shepherdr-attachment-route",
	"shepherdr-attachment-owner",
	"shepherdr-attachment-detached",
	"herdr-agents-monitor-state",
	"notes-session-prune",
	PRUNED_ENTRY,
]);

function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

export function deliveryId(value: {
	customType: string;
	details?: unknown;
}): string | undefined {
	const details = object(value.details);
	const metadata =
		value.customType === "codex-developer-message"
			? details
			: object(details?.["@howaboua/pi-codex-conversion/developer-message"]);
	return typeof metadata?.["id"] === "string" ? metadata["id"] : undefined;
}

export function pendingId(entry: SessionEntry): string | undefined {
	if (entry.type !== "custom") return;
	if (
		entry.customType !== "codex-pending-developer-message" &&
		entry.customType !== "herdr-pending-message"
	)
		return;
	const message = object(object(entry.data)?.["message"]);
	if (!message || typeof message["customType"] !== "string")
		throw new Error("Invalid pending coordination state.");
	if (entry.customType === "herdr-pending-message") {
		const id = object(message["details"])?.["herdrAdmissionId"];
		return typeof id === "string" ? id : undefined;
	}
	return deliveryId({
		customType: message["customType"],
		details: message["details"],
	});
}

/** Only complete owner snapshots are coalesced; unknown/delta protocols stay intact. */
export function snapshotKey(entry: SessionEntry): string | undefined {
	if (entry.type !== "custom") return;
	if (entry.customType === "herdr-agents-monitor-state") return "monitor";
	if (entry.customType === "pi-codex-conversion-notebook-tree-epoch")
		return "notebook-epoch";
	if (entry.customType === "notes-compaction:note:v1") {
		const revision = object(object(entry.data)?.["revision"]);
		if (typeof revision?.["path"] === "string")
			return `note:${revision["path"]}`;
	}
}

export function opaqueState(entry: SessionEntry): string | undefined {
	if (
		entry.type !== "custom" ||
		KNOWN_STATE.has(entry.customType) ||
		PROMPT_STATE.has(entry.customType) ||
		entry.customType.startsWith("shepherdr-board-") ||
		pendingId(entry)
	)
		return;
	return entry.customType;
}

function tombstone(entry: SessionEntry): SessionEntry {
	return {
		type: "custom",
		customType: PRUNED_ENTRY,
		id: entry.id,
		parentId: entry.parentId,
		timestamp: entry.timestamp,
	};
}

/** Retired conversation is reconstructed from visible blocks, never replay/details. */
export function pruneContent(
	entry: SessionEntry,
	full: boolean,
	expire: boolean,
	stateNeeded: boolean,
	delivered: ReadonlySet<string>,
): SessionEntry {
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user") {
			if (expire) return tombstone(entry);
			if (full) return entry;
			return {
				type: "message",
				id: entry.id,
				parentId: entry.parentId,
				timestamp: entry.timestamp,
				message: {
					role: "user",
					content: message.content,
					timestamp: message.timestamp,
				},
			};
		}
		if (message.role === "assistant") {
			if (full && !expire) return entry;
			const content = message.content
				.filter((part) =>
					full ? part.type !== "text" : !expire && part.type === "text",
				)
				.map((part) =>
					part.type === "text"
						? { type: "text" as const, text: part.text }
						: part,
				);
			if (!content.length) return tombstone(entry);
			return {
				type: "message",
				id: entry.id,
				parentId: entry.parentId,
				timestamp: entry.timestamp,
				message: {
					role: "assistant",
					content,
					api: message.api,
					provider: message.provider,
					model: message.model,
					usage: message.usage,
					stopReason: full ? message.stopReason : "stop",
					timestamp: message.timestamp,
				},
			};
		}
		return full ? entry : tombstone(entry);
	}
	if (full) return entry;
	if (entry.type === "custom_message") {
		const window = windowDetails(entry);
		const identity = window && {
			firstWindowId: window.identity.firstWindowId,
			currentWindowId: window.identity.currentWindowId,
			windowNumber: window.identity.windowNumber,
			...(window.identity.previousWindowId === undefined
				? {}
				: { previousWindowId: window.identity.previousWindowId }),
		};
		return window
			? {
					...entry,
					content: "",
					details:
						entry.customType === "codex-context-window"
							? {
									contextManagement: {
										kind: window.kind,
										...identity,
										trimPreviousWindow: window.trim,
									},
								}
							: { protocol: 1, kind: window.kind, identity, trim: window.trim },
				}
			: tombstone(entry);
	}
	if (entry.type === "custom") {
		const pending = pendingId(entry);
		if (pending && delivered.has(pending)) return tombstone(entry);
		if (
			PROMPT_STATE.has(entry.customType) ||
			(snapshotKey(entry) && !stateNeeded)
		)
			return tombstone(entry);
		return entry;
	}
	if (entry.type === "compaction")
		return {
			type: "compaction",
			id: entry.id,
			parentId: entry.parentId,
			timestamp: entry.timestamp,
			firstKeptEntryId: entry.firstKeptEntryId,
			summary: "",
			tokensBefore: 0,
			...(object(entry.details)?.["pi-notes-compaction/window-checkpoint"] === 1
				? { details: { "pi-notes-compaction/window-checkpoint": 1 } }
				: {}),
		};
	if (entry.type === "branch_summary")
		return {
			type: "branch_summary",
			id: entry.id,
			parentId: entry.parentId,
			timestamp: entry.timestamp,
			fromId: entry.fromId,
			summary: "",
			...(object(entry.details)?.["codexContextNoteHandoff"]
				? {
						details: {
							codexContextNoteHandoff: object(entry.details)?.[
								"codexContextNoteHandoff"
							],
						},
					}
				: {}),
		};
	if (entry.type === "context_edit") return tombstone(entry);
	return entry;
}
