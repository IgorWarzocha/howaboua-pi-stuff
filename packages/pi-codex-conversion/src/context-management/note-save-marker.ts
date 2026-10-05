import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { hasFreshContextNotes } from "./saved-notes.ts";

export const NOTE_SAVE_MARKER = "codex-note-save-marker";

export function recordNoteSaveMarker(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	windowId: string,
	mode: ContextManagementMode,
): void {
	const branch = ctx.sessionManager.getBranch();
	if (!ctx.isIdle() || !hasFreshContextNotes(branch, windowId, mode, true)) return;
	const completed = branch.findLast(entry => entry.type === "message" && entry.message.role === "assistant");
	if (!completed) return;
	// A tree return can exclude the marker's metadata child. Do not duplicate it.
	if (ctx.sessionManager.getEntries().some(entry => entry.type === "custom" && entry.customType === NOTE_SAVE_MARKER &&
		entry.data && typeof entry.data === "object" && "completedEntryId" in entry.data && entry.data.completedEntryId === completed.id)) return;
	pi.appendEntry(NOTE_SAVE_MARKER, { completedEntryId: completed.id });
	// Labels are user-owned. Never replace a user's bookmark.
	if (!ctx.sessionManager.getLabel(completed.id)) pi.setLabel(completed.id, "Notes saved");
}
