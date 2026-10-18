import { join } from "node:path";
import {
	type ExtensionAPI,
	type ExtensionContext,
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
import {
	modelIsActive,
	type NotesSettings,
	readSettings,
	writeSettings,
} from "./settings.js";
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

export default async function notesCompaction(pi: ExtensionAPI): Promise<void> {
	registerWindowRenderer(pi);
	const dir = join(getAgentDir(), "notes-compaction");
	const settingsPath = join(dir, "settings.json");
	const store = new NotesStore(join(dir, "notes.sqlite"));
	const lifecycle = new NotesLifecycle(pi, store);
	let settings: NotesSettings;
	let ready = false;
	const stopAdmission = pi.events.on(
		"pi-notes-compaction:custom-turn-admission:v1",
		(value) => {
			const request = value as {
				protocol?: number;
				ctx: Parameters<NotesLifecycle["prepareCustomTurn"]>[0];
				preparation?: Promise<void> | undefined;
			};
			if (request?.protocol === 1 && !request.preparation) {
				refreshActivation(request.ctx);
				request.preparation = lifecycle.prepareCustomTurn(request.ctx);
			}
		},
	);
	const tools = createTools(pi, store, lifecycle);
	try {
		const { registerGptPromptMode } = await import(
			"@howaboua/pi-codex-conversion/prompt-mode"
		);
		const registration = registerGptPromptMode(pi, () =>
			lifecycle.active ? tools : [],
		);
		lifecycle.gptPromptMode = () => registration.active;
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!("code" in error) ||
			![
				"ERR_MODULE_NOT_FOUND",
				"MODULE_NOT_FOUND",
				"ERR_PACKAGE_PATH_NOT_EXPORTED",
			].includes(String(error.code)) ||
			!error.message.includes("@howaboua/pi-codex-conversion")
		)
			throw error;
	}
	let ownSource: string | undefined;
	let unavailable: string | undefined;
	const owner: NotesOwner = {
		protocol: 1,
		owner: "pi-notes-compaction",
		identity: () =>
			lifecycle.windows.current ? { ...lifecycle.windows.current } : undefined,
		projectMessages: (messages, entries) => {
			if (entries) lifecycle.windows.restore(entries);
			const projected = lifecycle.windows.projectMessages(
				messages,
				lifecycle.bridge?.prepareReminder,
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
		allowsCompaction: (reason) => lifecycle.allowsCompaction(reason),
		allowsWindowRequests: () => lifecycle.newWindowRequests !== "off",
		canBind: (ctx, entries = ctx.sessionManager.getEntries()) =>
			lifecycle.active &&
			ctx.isIdle() &&
			entries.every((entry) => {
				// The first startup after an update records a UI-only changelog.
				if (
					entry.type === "custom" &&
					entry.customType === "@howaboua/pi-stuff/changelog"
				)
					return true;
				// PCC links the fresh worker before binding its shared notes family.
				if (
					entry.type === "custom" &&
					entry.customType === "codex-agent-relationship"
				)
					return (
						(entry.data as { threadId?: unknown } | undefined)?.threadId ===
						ctx.sessionManager.getSessionId()
					);
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
		if (request.protocol === 1 && ready && !unavailable)
			request.projection?.(owner);
		if (
			request.protocol === 1 &&
			typeof request.reply === "function" &&
			ready &&
			!unavailable &&
			(request.ctx
				? modelIsActive(settings, request.ctx.model)
				: lifecycle.active)
		)
			request.reply(owner);
	});

	function refreshActivation(ctx: ExtensionContext): void {
		if (!ready || unavailable) return;
		const active = modelIsActive(settings, ctx.model);
		if (!active) {
			if (lifecycle.active) lifecycle.reset(ctx);
			lifecycle.active = false;
			if (lifecycle.bridge) {
				// PCC rediscovers ownership before deciding its native policy.
				lifecycle.bridge.configureTools?.(tools, ctx, {
					notes: NOTES_USAGE,
					history: HISTORY_USAGE,
				});
			} else {
				pi.setActiveTools(
					pi
						.getActiveTools()
						.filter((name) => !TOOL_NAMES.some((tool) => tool === name)),
				);
			}
			return;
		}
		if (lifecycle.active) return;
		try {
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
			configureTools(ctx);
			store.updateFile(sessionRef(ctx));
		} catch (error) {
			lifecycle.active = false;
			unavailable = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Notes continuity inactive: ${unavailable}`, "warning");
		}
	}
	function configureTools(ctx: ExtensionContext): void {
		if (lifecycle.bridge) {
			lifecycle.bridge.configureTools?.(tools, ctx, {
				notes: NOTES_USAGE,
				history: HISTORY_USAGE,
			});
			return;
		}
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
	}
	function applySettings(value: NotesSettings): void {
		settings = value;
		lifecycle.normalCompaction = value.normalCompaction;
		lifecycle.newWindowRequests = value.newWindowRequests;
		lifecycle.idleMinutes = value.idleMinutes;
		lifecycle.taskBoundaryReminder = value.taskBoundaryReminder;
	}
	pi.on("session_start", (_event, ctx) => {
		lifecycle.reset(ctx);
		lifecycle.active = false;
		ready = false;
		unavailable = undefined;
		try {
			settings = readSettings(settingsPath);
			writeSettings(settingsPath, settings);
			applySettings(settings);
			lifecycle.bridge = discoverBridge(pi);
			ready = true;
			// Register standalone tools even when initially hidden, for later model switches.
			if (!lifecycle.bridge) {
				if (
					pi
						.getAllTools()
						.some(
							(tool) =>
								TOOL_NAMES.some((name) => name === tool.name) &&
								tool.sourceInfo.path !== ownSource,
						)
				)
					throw new Error(
						"Another extension already owns notes continuity. Update it to a version supporting notes integration, then reload Pi.",
					);
				for (const tool of tools) pi.registerTool(tool);
				ownSource = pi.getAllTools().find((tool) => tool.name === "notes")
					?.sourceInfo.path;
			}
			refreshActivation(ctx);
		} catch (error) {
			unavailable = error instanceof Error ? error.message : String(error);
			ctx.ui.notify(`Notes continuity inactive: ${unavailable}`, "warning");
		}
	});
	pi.on("before_agent_start", (event, ctx) => {
		refreshActivation(ctx);
		if (lifecycle.active) return lifecycle.beforeStart(ctx, event);
	});
	pi.on("input", (event, ctx) => {
		refreshActivation(ctx);
		return lifecycle.active ? lifecycle.input(event, ctx) : undefined;
	});
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
	pi.on("turn_end", (event, ctx) => {
		if (!lifecycle.active || lifecycle.newWindowRequests === "off") return;
		const reminder = lifecycle.windows.reminder(
			ctx,
			event.message.role === "assistant" &&
				!ctx.signal?.aborted &&
				!["error", "length", "aborted"].includes(event.message.stopReason) &&
				event.toolResults.length > 0 &&
				pi.getActiveTools().includes("new_context")
				? lifecycle.taskBoundaryReminder
				: 0,
			!lifecycle.fresh(ctx, lifecycle.runId),
		);
		return reminder
			? {
					entries: [
						...event.entries,
						lifecycle.bridge?.prepareReminder?.(reminder) ?? reminder,
					],
				}
			: undefined;
	});
	pi.on("context", (event, ctx) => {
		try {
			return {
				messages: owner.projectMessages(
					event.messages,
					ctx.sessionManager.getBranch(),
				),
			};
		} catch (error) {
			ctx.abort();
			throw error;
		}
	});
	pi.on("session_before_compact", (event, ctx) =>
		ready && !unavailable ? lifecycle.beforeCompact(event, ctx) : undefined,
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
	});
	pi.on("model_select", (_event, ctx) => {
		refreshActivation(ctx);
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
		stopAdmission();
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
			const save = (value: NotesSettings) => {
				writeSettings(settingsPath, value);
				applySettings(value);
				refreshActivation(ctx);
				if (lifecycle.active) configureTools(ctx);
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
					settings: () => settings,
					save,
					settingsPath,
					prune,
					status: () => {
						const counts = store.status();
						return [
							lifecycle.active
								? "Continuity active"
								: `Continuity inactive: ${unavailable ?? (ready ? "model not in whitelist" : "not initialized")}`,
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
