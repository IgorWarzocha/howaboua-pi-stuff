import { dirname, join } from "node:path";
import type {
	ExtensionAPI,
	ExtensionCommandContext,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { FeatureSettings, OpenSettings } from "../settings-navigation.js";
import type { NotesRuntime } from "./index.js";
import {
	legacyNotesConfigured,
	loadNotesSettings,
	modelIsActive,
	type NotesSettings,
	notesSettingsPath,
	writeSettings,
} from "./settings.js";
import type { NotesSettingsOwner } from "./settings-command.js";
import type { NotesStore } from "./store.js";

/** Dormant sessions need only settings; saved continuity still owns its history cuts. */
function hasSavedContinuity(ctx: ExtensionContext): boolean {
	return ctx.sessionManager.getEntries().some((entry) => {
		if (entry.type === "custom" || entry.type === "custom_message")
			return (
				entry.customType.startsWith("notes-compaction:") ||
				[
					"codex-context-agent",
					"codex-context-backend",
					"codex-context-note",
					"codex-context-note-snapshot",
					"codex-context-window",
					"codex-context-tree-archive",
					"codex-note-save-marker",
				].includes(entry.customType)
			);
		return (
			entry.type === "compaction" &&
			entry.details !== null &&
			typeof entry.details === "object" &&
			"pi-notes-compaction/window-checkpoint" in entry.details
		);
	});
}

export function createNotesFeature(
	pi: ExtensionAPI,
	openSettings: OpenSettings,
): FeatureSettings {
	let settings: NotesSettings | undefined;
	let runtime: NotesRuntime | undefined;
	let loading: Promise<NotesRuntime> | undefined;
	let store: NotesStore | undefined;
	let storage: Promise<NotesStore> | undefined;
	let closed = false;
	const ensureStore = () =>
		(storage ??= (async () => {
			const { NotesStore } = await import("./store.js");
			if (closed) throw new Error("Session changed; reopen Notes settings");
			return (store = new NotesStore(
				join(dirname(notesSettingsPath()), "notes.sqlite"),
			));
		})());
	const ensure = (ctx: ExtensionContext): Promise<NotesRuntime> => {
		if (loading) return loading;
		loading = (async () => {
			const { createNotesRuntime } = await import("./index.js");
			if (closed) throw new Error("Session changed; reopen Notes settings");
			runtime = await createNotesRuntime(pi, await ensureStore());
			if (closed) throw new Error("Session changed; reopen Notes settings");
			await runtime.start(ctx, settings);
			return runtime;
		})();
		return loading;
	};
	const owner: NotesSettingsOwner = {
		get settings() {
			if (!settings)
				throw new Error(
					"Notes settings are unavailable; fix the settings file and reload Pi",
				);
			return settings;
		},
		get runtime() {
			return runtime;
		},
		async save(value, ctx) {
			if (runtime) runtime.activation.save(value, ctx);
			else writeSettings(notesSettingsPath(), value);
			settings = value;
			if (!runtime && modelIsActive(value, ctx.model)) await ensure(ctx);
		},
		start: ensure,
	};
	const open = async (
		ctx: ExtensionCommandContext,
		initial: "notes" | "roles" = "notes",
	) => {
		const { createNotesSettings } = await import("./settings-command.js");
		return createNotesSettings(
			owner,
			await ensureStore(),
			notesSettingsPath(),
		)(ctx, initial);
	};
	pi.on("session_start", async (_event, ctx) => {
		try {
			settings = loadNotesSettings(ctx);
			writeSettings(notesSettingsPath(), settings);
			if (
				modelIsActive(settings, ctx.model) ||
				hasSavedContinuity(ctx) ||
				legacyNotesConfigured(ctx)
			)
				await ensure(ctx);
		} catch (error) {
			ctx.ui.notify(
				`Notes continuity inactive: ${error instanceof Error ? error.message : String(error)}`,
				"warning",
			);
		}
	});
	pi.on("model_select", async (_event, ctx) => {
		if (!runtime && settings && modelIsActive(settings, ctx.model))
			await ensure(ctx);
	});
	pi.on("session_shutdown", () => {
		closed = true;
		store?.close();
	});
	pi.registerCommand("notes", {
		description: "Manage local notes and context rollover",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify("Use /notes to open settings.", "info");
				return;
			}
			await openSettings(ctx, "notes");
		},
	});
	pi.registerCommand("roles", {
		description: "View model roles and JSON configuration guidance",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify(
					"Use /roles to view roles and JSON configuration guidance.",
					"info",
				);
				return;
			}
			const next = await open(ctx, "roles");
			if (next) await openSettings(ctx, next);
		},
	});
	return {
		async openSettings(ctx) {
			return open(ctx);
		},
	};
}
