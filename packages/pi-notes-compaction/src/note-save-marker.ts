import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { hasFreshNotes } from "./fresh-notes.js";

const NOTE_SAVE_MARKER = "codex-note-save-marker";

/** Display and bookmarks share the same completed checkpoint evidence. */
export function registerNoteSaveMarkers(
	pi: ExtensionAPI,
	enabled: () => boolean,
) {
	let manager: ExtensionContext["sessionManager"] | undefined;
	let cached: { leaf: string | null; id: string | undefined } | undefined;
	const restore = (_event: unknown, ctx: ExtensionContext) => {
		manager = ctx.sessionManager;
		cached = undefined;
	};
	pi.on("session_start", restore);
	pi.on("session_tree", restore);
	pi.on("session_compact", restore);
	pi.on("session_shutdown", () => {
		manager = undefined;
		cached = undefined;
	});
	pi.registerEntryRenderer(NOTE_SAVE_MARKER, (entry, _options, theme) => {
		if (!enabled()) return undefined;
		const content = theme.fg("success", "✓ Notes saved");
		return new (class extends Text {
			override render(width: number): string[] {
				const leaf = manager?.getLeafId();
				if (manager && (!cached || cached.leaf !== leaf))
					cached = {
						leaf: manager.getLeafId(),
						id: manager
							.getBranch()
							.findLast(
								(item) =>
									item.type === "custom" &&
									item.customType === NOTE_SAVE_MARKER,
							)?.id,
					};
				const visible = manager && enabled() && cached?.id === entry.id;
				this.setText(visible ? content : "");
				return visible ? super.render(width) : [];
			}
		})("", 0, 0);
	});
	return {
		record(
			ctx: ExtensionContext,
			windowId: string | undefined,
			runId: string,
			aborted: boolean,
		) {
			if (
				!enabled() ||
				aborted ||
				!ctx.isIdle() ||
				!hasFreshNotes(ctx.sessionManager.getBranch(), windowId, runId)
			)
				return;
			const completed = ctx.sessionManager
				.getBranch()
				.findLast(
					(entry) =>
						entry.type === "message" && entry.message.role === "assistant",
				);
			if (
				!completed ||
				ctx.sessionManager
					.getEntries()
					.some(
						(entry) =>
							entry.type === "custom" &&
							entry.customType === NOTE_SAVE_MARKER &&
							entry.data &&
							typeof entry.data === "object" &&
							"completedEntryId" in entry.data &&
							entry.data.completedEntryId === completed.id,
					)
			)
				return;
			pi.appendEntry(NOTE_SAVE_MARKER, { completedEntryId: completed.id });
		},
		bookmark(ctx: ExtensionContext, windowId: string | undefined) {
			if (!enabled()) return;
			const branch = ctx.sessionManager.getBranch();
			const marker = branch.findLastIndex(
				(entry) =>
					entry.type === "custom" && entry.customType === NOTE_SAVE_MARKER,
			);
			if (marker < 0) return;
			const promptIndex = branch.findIndex(
				(entry, index) =>
					index > marker &&
					entry.type === "message" &&
					entry.message.role === "user",
			);
			const prompt = branch[promptIndex];
			if (
				!prompt ||
				ctx.sessionManager.getLabel(prompt.id) ||
				!hasFreshNotes(branch.slice(0, promptIndex), windowId)
			)
				return;
			pi.setLabel(prompt.id, "Notes");
		},
	};
}
