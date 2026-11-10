import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotesOwner } from "./bridge.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { exportNotesSnapshot } from "./notes.js";
import type { NotesStore } from "./store.js";
import { createSharedExecutor } from "./tools.js";
import { WINDOW_MESSAGE, windowDetails } from "./windows.js";

export function createNotesContextOwner(
	pi: ExtensionAPI,
	store: NotesStore,
	lifecycle: NotesLifecycle,
	search: HistorySearch,
): NotesOwner {
	const owner: NotesOwner = {
		protocol: 1,
		owner: "pi-notes-compaction",
		identity: () =>
			lifecycle.windows.current ? { ...lifecycle.windows.current } : undefined,
		projectMessages: (messages, entries) => {
			if (entries) lifecycle.windows.restore(entries);
			const projected = lifecycle.windows.projectMessages(
				messages,
				lifecycle.prepareReminder,
			);
			return lifecycle.active
				? projected
				: projected.filter(
						(message) =>
							message.role !== "custom" ||
							!message.customType.startsWith("notes-compaction:"),
					);
		},
		projectBranch: (entries) => lifecycle.windows.projectBranch(entries),
		canBind: (ctx, entries = ctx.sessionManager.getEntries()) =>
			lifecycle.active &&
			ctx.isIdle() &&
			entries.every((entry) => {
				if (
					entry.type === "custom" &&
					entry.customType === "codex-agent-relationship"
				)
					return (
						(entry.data as { threadId?: unknown } | undefined)?.threadId ===
						ctx.sessionManager.getSessionId()
					);
				if (
					entry.type === "custom" &&
					entry.customType === "herdr-agents-monitor-state"
				) {
					const data = entry.data as
						| { version?: unknown; agents?: unknown }
						| undefined;
					return Boolean(
						data?.version === 2 &&
							Array.isArray(data.agents) &&
							data.agents.length === 0,
					);
				}
				// Foreign plain custom entries may be startup metadata. Notes state
				// proves prior ownership or work, even without a delivered first turn.
				if (entry.type === "custom")
					return (
						!entry.customType.startsWith("notes-compaction:") &&
						![
							"codex-context-agent",
							"codex-context-backend",
							"codex-context-note",
							"codex-context-note-snapshot",
							"codex-context-window",
							"codex-context-tree-archive",
							"codex-note-save-marker",
						].includes(entry.customType)
					);
				if (
					["model_change", "thinking_level_change", "session_info"].includes(
						entry.type,
					)
				)
					return true;
				if (
					entry.type !== "custom_message" ||
					entry.customType !== WINDOW_MESSAGE
				)
					return false;
				const details = windowDetails(entry);
				return Boolean(
					details &&
						details.identity.windowNumber === 0 &&
						!details.trim &&
						(details.kind === "window" || details.kind === "identity"),
				);
			}),
		snapshotNotes: exportNotesSnapshot,
		executeShared: createSharedExecutor(pi, store, lifecycle, search),
	};
	return owner;
}
