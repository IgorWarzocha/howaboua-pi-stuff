import type {
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SettingsTab } from "../settings-navigation.js";
import type { NotesRuntime } from "./index.js";
import { sessionRef } from "./notes.js";
import type { NotesSettings } from "./settings.js";
import { openNotesSettings } from "./settings-screen.js";
import type { NotesStore } from "./store.js";

export interface NotesSettingsOwner {
	readonly settings: NotesSettings;
	readonly runtime: NotesRuntime | undefined;
	save(settings: NotesSettings, ctx: ExtensionContext): Promise<void>;
	start(ctx: ExtensionContext): Promise<NotesRuntime>;
}

export function createNotesSettings(
	owner: NotesSettingsOwner,
	store: NotesStore,
	settingsPath: string,
	boardTab = true,
) {
	const open = async (
		ctx: ExtensionCommandContext,
		initial: "notes" | "roles" = "notes",
	): Promise<SettingsTab | undefined> => {
		let tab = initial;
		while (true) {
			if (tab === "roles") {
				const { roles } = await owner.start(ctx);
				if ((await roles.command("", ctx)) !== "notes") return;
				tab = "notes";
			}
			if (!ctx.hasUI) {
				ctx.ui.notify("Notes settings require interactive Pi.", "warning");
				return;
			}
			const save = (value: NotesSettings) => owner.save(value, ctx);
			const prune = async () => {
				await ctx.waitForIdle();
				const { search } = await owner.start(ctx);
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
				const next = await openNotesSettings(ctx, {
					boardTab,
					settings: () => owner.settings,
					save,
					settingsPath,
					prune,
					sessionPruning: {
						get: () => store.pruningPolicy(ctx.sessionManager.getSessionId()),
						save: (value) =>
							store.setPruningPolicy(ctx.sessionManager.getSessionId(), value),
						run: async (interaction) => {
							await ctx.waitForIdle();
							const { sessionPruning } = await owner.start(ctx);
							await sessionPruning.run(ctx, true, interaction);
						},
					},
					status: () => {
						const counts = store.status();
						const activation = owner.runtime?.activation;
						const lifecycle = owner.runtime?.lifecycle;
						return [
							lifecycle?.active
								? "Continuity active"
								: `Continuity inactive: ${activation?.unavailable ?? (owner.settings.active === "off" ? "off" : "model not in whitelist")}`,
							`${counts.sessions} sessions · ${counts.revisions} note revisions · ${counts.cachedResponses} cached responses`,
							`Hybrid lookup: ${lifecycle?.bridge?.lookup ? "available" : "unavailable"} · Encrypted delivery: ${lifecycle?.bridge?.projectResult ? "available" : "unavailable"}`,
						];
					},
				});
				if (next !== "roles") return next;
				tab = "roles";
			} catch (error) {
				ctx.ui.notify(`Notes settings failed: ${String(error)}`, "error");
				return;
			}
		}
	};
	return open;
}
