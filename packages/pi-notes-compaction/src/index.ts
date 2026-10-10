import { join } from "node:path";
import {
	type ExtensionAPI,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import {
	discoverBridge,
	type NotesOwner,
	OWNER_CHANNEL,
	type OwnerRequest,
	TOOL_NAMES,
} from "./bridge.js";
import { NotesLifecycle } from "./lifecycle.js";
import { exportNotesSnapshot, sessionRef } from "./notes.js";
import { type NotesSettings, readSettings, writeSettings } from "./settings.js";
import { openNotesSettings } from "./settings-screen.js";
import { NotesStore } from "./store.js";
import {
	createSharedExecutor,
	createTools,
	HISTORY_USAGE,
	NOTES_USAGE,
} from "./tools.js";
import {
	registerWindowRenderer,
	WINDOW_MESSAGE,
	windowDetails,
} from "./windows.js";

export default function notesCompaction(pi: ExtensionAPI): void {
	registerWindowRenderer(pi);
	const dir = join(getAgentDir(), "notes-compaction");
	const settingsPath = join(dir, "settings.json");
	const store = new NotesStore(join(dir, "notes.sqlite"));
	const lifecycle = new NotesLifecycle(pi, store);
	const tools = createTools(pi, store, lifecycle);
	let ownSource: string | undefined;
	let unavailable: string | undefined;
	const owner: NotesOwner = {
		protocol: 1,
		owner: "pi-notes-compaction",
		identity: () =>
			lifecycle.windows.current ? { ...lifecycle.windows.current } : undefined,
		projectMessages: (messages) => lifecycle.windows.projectMessages(messages),
		projectBranch: (entries) => lifecycle.windows.projectBranch(entries),
		canBind: (ctx) =>
			lifecycle.active &&
			ctx.isIdle() &&
			ctx.sessionManager.getEntries().every((entry) => {
				// The first startup after an update records a UI-only changelog.
				if (
					entry.type === "custom" &&
					entry.customType === "@howaboua/pi-stuff/changelog"
				)
					return true;
				// Herdr activation persists its empty registry before first task delivery.
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
				// Board adoption precedes context binding on a fresh spawn. These
				// metadata records are preparation, not evidence of a first turn.
				if (
					entry.type === "custom" &&
					[
						"shepherdr-board-binding",
						"shepherdr-board-awareness",
						"codex-context-briefing",
					].includes(entry.customType)
				)
					return true;
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
		executeShared: createSharedExecutor(pi, store, lifecycle),
	};
	const stopOwner = pi.events.on(OWNER_CHANNEL, (data) => {
		if (!data || typeof data !== "object") return;
		const request = data as Partial<OwnerRequest>;
		if (request.protocol === 1 && typeof request.reply === "function")
			request.reply(owner);
	});

	pi.on("session_start", (_event, ctx) => {
		lifecycle.reset(ctx);
		lifecycle.active = false;
		unavailable = undefined;
		try {
			Object.assign(lifecycle, readSettings(settingsPath));
			lifecycle.bridge = discoverBridge(pi);
			const claim = lifecycle.bridge?.claim(owner);
			if (claim && !claim.claimed) throw new Error(claim.reason);
			if (claim?.claimed) {
				claim.registerTools(tools, ctx);
			} else {
				const conflicts = pi
					.getAllTools()
					.filter(
						(tool) =>
							TOOL_NAMES.some((name) => name === tool.name) &&
							tool.sourceInfo.path !== ownSource,
					);
				if (conflicts.length)
					throw new Error(
						"Another extension already owns notes continuity. Installed PCC needs the documented takeover bridge before these extensions can run together.",
					);
				for (const tool of tools) pi.registerTool(tool);
				ownSource = pi.getAllTools().find((tool) => tool.name === "notes")
					?.sourceInfo.path;
			}
			lifecycle.active = true;
			lifecycle.initialize(ctx);
			lifecycle.bridge?.configureTools?.(tools, ctx, {
				notes: NOTES_USAGE,
				history: HISTORY_USAGE,
			});
			store.updateFile(sessionRef(ctx));
		} catch (error) {
			lifecycle.active = false;
			unavailable = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Notes continuity inactive: ${unavailable}`, "warning");
		}
	});
	pi.on("before_agent_start", (_event, ctx) => {
		if (lifecycle.active) lifecycle.beforeStart(ctx);
	});
	pi.on("input", (event, ctx) =>
		lifecycle.active ? lifecycle.input(event, ctx) : undefined,
	);
	pi.on("agent_before_settle", (event) => {
		if (lifecycle.active) lifecycle.outcome(event.outcome);
	});
	pi.on("agent_settled", async (event, ctx) => {
		if (!lifecycle.active) return;
		try {
			await lifecycle.settled(event, ctx);
		} catch (error) {
			ctx.ui.notify(
				`Context rollover failed: ${error instanceof Error ? error.message : String(error)}`,
				"error",
			);
		}
	});
	pi.on("turn_end", (_event, ctx) => {
		if (!lifecycle.active || lifecycle.fresh(ctx, lifecycle.runId)) return;
		const reminder = lifecycle.windows.reminder(ctx);
		return reminder ? { entries: [reminder] } : undefined;
	});
	pi.on("context", (event, ctx) => {
		if (!lifecycle.active) return;
		try {
			lifecycle.windows.restore(ctx.sessionManager.getBranch());
			return { messages: lifecycle.windows.projectMessages(event.messages) };
		} catch (error) {
			ctx.abort();
			throw error;
		}
	});
	pi.on("session_before_compact", (event, ctx) =>
		lifecycle.active ? lifecycle.beforeCompact(event, ctx) : undefined,
	);
	pi.on("session_compact_failed", async (event, ctx) => {
		if (lifecycle.active) await lifecycle.compactFailed(event, ctx);
	});
	pi.on("session_compact", (_event, ctx) => {
		if (lifecycle.active)
			lifecycle.windows.restore(ctx.sessionManager.getBranch());
	});
	pi.on("session_tree", (_event, ctx) => {
		lifecycle.reset(ctx);
		if (lifecycle.active) lifecycle.initialize(ctx);
	});
	pi.on("model_select", (_event, ctx) => {
		if (lifecycle.active)
			lifecycle.bridge?.configureTools?.(tools, ctx, {
				notes: NOTES_USAGE,
				history: HISTORY_USAGE,
			});
	});
	pi.on("session_shutdown", () => {
		lifecycle.reset();
		lifecycle.active = false;
		store.close();
		stopOwner();
	});

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
			const save = (settings: NotesSettings) => {
				writeSettings(settingsPath, settings);
				Object.assign(lifecycle, settings);
			};
			const prune = async () => {
				await ctx.waitForIdle();
				store.updateFile(sessionRef(ctx));
				const result = store.prune(ctx.sessionManager.getSessionId());
				ctx.ui.notify(
					`Pruned ${result.removed} sessions. Retained ${result.unknownPaths} unknown paths and ${result.inaccessible} inaccessible files.`,
					"info",
				);
			};
			try {
				await openNotesSettings(ctx, {
					settings: () => ({
						normalCompaction: lifecycle.normalCompaction,
						idleMinutes: lifecycle.idleMinutes,
					}),
					save,
					prune,
					status: () => {
						const counts = store.status();
						return [
							lifecycle.active
								? "Continuity active"
								: `Continuity inactive: ${unavailable ?? "not initialized"}`,
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
