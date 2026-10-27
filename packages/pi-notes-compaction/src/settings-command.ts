import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { sessionRef } from "./notes.js";
import type { SessionPruning } from "./session-pruning.js";
import type { NotesSettings } from "./settings.js";
import { openNotesSettings } from "./settings-screen.js";
import type { NotesStore } from "./store.js";

export function registerNotesSettingsCommand(
	pi: ExtensionAPI,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
	store: NotesStore,
	search: HistorySearch,
	settingsPath: string,
	sessionPruning: SessionPruning,
): void {
	pi.registerCommand("notes", {
		description: "Manage local notes and context rollover",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Use /notes to open settings.", "info");
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("Notes settings require interactive Pi.", "warning");
				return;
			}
			const save = (value: NotesSettings) => activation.save(value, ctx);
			const prune = async () => {
				await ctx.waitForIdle();
				store.updateFile(sessionRef(ctx));
				const sources = store.sessionFiles();
				const result = store.prune(ctx.sessionManager.getSessionId());
				const indexed = await search.prune(
					ctx.sessionManager.getSessionId(),
					sources,
				);
				ctx.ui.notify(
					`Pruned ${result.removed} Notes sessions and ${indexed.removed} indexed sessions. Retained ${result.unknownPaths + indexed.unknownPaths} unknown paths and ${result.inaccessible + indexed.inaccessible} inaccessible files.${indexed.storageBusy ? " Index storage cleanup is pending; run Prune again when other agents are idle." : ""}`,
					"info",
				);
			};
			try {
				await openNotesSettings(ctx, {
					settings: () => activation.settings,
					save,
					settingsPath,
					prune,
					sessionPruning: {
						get: () => store.pruningPolicy(ctx.sessionManager.getSessionId()),
						save: (value) =>
							store.setPruningPolicy(ctx.sessionManager.getSessionId(), value),
						run: async () => {
							await ctx.waitForIdle();
							await sessionPruning.run(ctx, true);
						},
					},
					status: () => {
						const counts = store.status();
						return [
							lifecycle.active
								? "Continuity active"
								: `Continuity inactive: ${activation.unavailable ?? (activation.ready ? "model not in whitelist" : "not initialized")}`,
							`${counts.sessions} sessions · ${counts.revisions} note revisions · ${counts.cachedResponses} cached responses`,
							`Hybrid lookup: ${lifecycle.bridge?.lookup ? "available" : "unavailable"} · Encrypted delivery: ${lifecycle.bridge?.projectResult ? "available" : "unavailable"}`,
						];
					},
				});
			} catch (error) {
				ctx.ui.notify(`Notes settings failed: ${String(error)}`, "error");
			}
		},
	});
}
