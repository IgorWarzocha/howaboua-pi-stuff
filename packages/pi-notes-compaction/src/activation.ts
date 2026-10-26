import { join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CONFIG_DIR_NAME, getAgentDir } from "@earendil-works/pi-coding-agent";
import { type NotesBridge, TOOL_NAMES } from "./bridge.js";
import { indexHistory } from "./history.js";
import type { HistorySearch } from "./history-search.js";
import type { NotesLifecycle } from "./lifecycle.js";
import { sessionRef } from "./notes.js";
import {
	modelIsActive,
	type NotesSettings,
	readSettings,
	writeSettings,
} from "./settings.js";
import type { NotesStore } from "./store.js";

export function createNotesActivation(
	pi: ExtensionAPI,
	store: NotesStore,
	search: HistorySearch,
	lifecycle: NotesLifecycle,
	settingsPath: string,
	refreshNested: () => void,
) {
	let settings: NotesSettings;
	let ready = false;
	let unavailable: string | undefined;
	function refreshActivation(ctx: ExtensionContext): void {
		if (!ready || unavailable) return;
		const active = modelIsActive(settings, ctx.model);
		if (!active) {
			if (lifecycle.active) lifecycle.reset(ctx);
			lifecycle.active = false;
			search.setSession(undefined);
			pi.setActiveTools(
				pi
					.getActiveTools()
					.filter((name) => !TOOL_NAMES.some((tool) => tool === name)),
			);
			refreshNested();
			return;
		}
		if (lifecycle.active) return;
		try {
			lifecycle.active = true;
			configureTools();
			store.updateFile(sessionRef(ctx));
			refreshHistorySearch(ctx);
		} catch (error) {
			lifecycle.active = false;
			unavailable = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Notes continuity inactive: ${unavailable}`, "warning");
		}
	}
	function configureTools(): void {
		const names = TOOL_NAMES.filter(
			(name) => name !== "new_context" || lifecycle.newWindowRequests !== "off",
		);
		pi.setActiveTools([
			...new Set([
				...pi
					.getActiveTools()
					.filter((name) => !TOOL_NAMES.some((tool) => tool === name)),
				...names,
			]),
		]);
		refreshNested();
	}
	function refreshHistorySearch(ctx: ExtensionContext, update = false): void {
		const sessionId =
			lifecycle.active && settings.rankedHistorySearch
				? ctx.sessionManager.getSessionId()
				: undefined;
		const changed = search.setSession(
			sessionId,
			ctx.sessionManager.getSessionFile(),
		);
		if (!sessionId || (!changed && !update)) return;
		void indexHistory(
			ctx.sessionManager.getBranch(),
			sessionId,
			search,
			ctx.sessionManager.getEntries(),
		).catch((error: unknown) => {
			if (!search.isEnabled(sessionId)) return;
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				"warning",
			);
		});
	}
	function applySettings(value: NotesSettings): void {
		settings = value;
		lifecycle.normalCompaction = value.normalCompaction;
		lifecycle.newWindowRequests = value.newWindowRequests;
		lifecycle.idleMinutes = value.idleMinutes;
		lifecycle.taskBoundaryReminder = value.taskBoundaryReminder;
	}
	function start(ctx: ExtensionContext, family: NotesBridge): void {
		search.setSession(undefined);
		lifecycle.reset(ctx);
		lifecycle.active = false;
		ready = false;
		unavailable = undefined;
		try {
			settings = readSettings(settingsPath, [
				join(getAgentDir(), "pi-codex-conversion.json"),
				...(ctx.isProjectTrusted()
					? [join(ctx.cwd, CONFIG_DIR_NAME, "pi-codex-conversion.json")]
					: []),
			]);
			writeSettings(settingsPath, settings);
			applySettings(settings);
			lifecycle.bridge = family;
			ready = true;

			refreshActivation(ctx);
		} catch (error) {
			unavailable = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Notes continuity inactive: ${unavailable}`, "warning");
		}
	}
	function save(value: NotesSettings, ctx: ExtensionContext): void {
		writeSettings(settingsPath, value);
		applySettings(value);
		refreshActivation(ctx);
		refreshHistorySearch(ctx);
		if (lifecycle.active) configureTools();
	}
	return {
		start,
		save,
		refreshActivation,
		refreshHistorySearch,
		get settings() {
			return settings;
		},
		get ready() {
			return ready;
		},
		get unavailable() {
			return unavailable;
		},
		get available() {
			return ready && !unavailable;
		},
	};
}
export type NotesActivation = ReturnType<typeof createNotesActivation>;
