import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { hasFreshContextNotes } from "./saved-notes.ts";

export const NOTE_SAVE_MARKER = "codex-note-save-marker";

const latestMarkers = new WeakMap<ExtensionContext["sessionManager"], {
	leafId: string | null;
	markerId: string | undefined;
}>();

export function latestNoteSaveMarker(manager: ExtensionContext["sessionManager"]): string | undefined {
	const leafId = manager.getLeafId();
	const cached = latestMarkers.get(manager);
	if (cached && cached.leafId === leafId) return cached.markerId;
	// Appends, tree navigation and compaction change the public active leaf.
	// Share one ancestry scan across every marker and redraw at that leaf.
	const markerId = manager.getBranch().findLast(entry =>
		entry.type === "custom" && entry.customType === NOTE_SAVE_MARKER)?.id;
	latestMarkers.set(manager, { leafId, markerId });
	return markerId;
}

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
}

/** Context preparation runs after Pi persists the user prompt, unlike message hooks. */
export function bookmarkNotesContinuation(
	pi: ExtensionAPI,
	ctx: ExtensionContext,
	windowId: string,
	mode: ContextManagementMode,
): void {
	const branch = ctx.sessionManager.getBranch();
	const markerIndex = branch.findLastIndex(entry => entry.type === "custom" && entry.customType === NOTE_SAVE_MARKER);
	if (markerIndex < 0) return;
	const promptIndex = branch.findIndex((entry, index) => index > markerIndex && entry.type === "message" && entry.message.role === "user");
	const prompt = branch[promptIndex];
	if (!prompt || ctx.sessionManager.getLabel(prompt.id)) return;
	if (!hasFreshContextNotes(branch.slice(0, promptIndex), windowId, mode, true)) return;
	// Selecting a user entry in /tree restores its prompt and returns to its parent.
	pi.setLabel(prompt.id, "Notes");
}
