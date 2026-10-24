import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
	CONFIG_DIR_NAME,
	type ExtensionAPI,
	type ExtensionContext,
	getAgentDir,
} from "@earendil-works/pi-coding-agent";
import { contextAgentIdentity, contextTargetAgent } from "./agent-identity.js";
import {
	type NotesOwner,
	OWNER_CHANNEL,
	type OwnerRequest,
	TOOL_NAMES,
} from "./bridge.js";
import { NESTED_NOTE_OUTCOME, type NestedNoteOutcome } from "./fresh-notes.js";
import { NotesLifecycle } from "./lifecycle.js";
import { registerNoteSaveMarkers } from "./note-save-marker.js";
import { exportNotesSnapshot, sessionRef } from "./notes.js";
import {
	modelIsActive,
	type NotesSettings,
	readSettings,
	writeSettings,
} from "./settings.js";
import { openNotesSettings } from "./settings-screen.js";
import { registerContextSharingService } from "./sharing-service.js";
import { NotesStore } from "./store.js";
import {
	createSharedExecutor,
	createTools,
	HISTORY_USAGE,
	NOTES_USAGE,
} from "./tools.js";
import {
	projectTreeCheckpointBranch,
	projectTreeCheckpointMessages,
} from "./tree-checkpoint.js";
import {
	projectTreeHandoffBranch,
	projectTreeHandoffReads,
} from "./tree-handoff-read.js";
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
	let refreshNested = () => {};
	try {
		const { adaptToolForCodeMode, registerCodeModeExtensionTools } =
			await import("@howaboua/pi-codex-conversion/code-mode");
		const registration = registerCodeModeExtensionTools(
			pi,
			() =>
				tools
					.filter((tool) => tool.name === "notes" || tool.name === "history")
					.map((tool) =>
						adaptToolForCodeMode(tool, {
							discovery: "help",
							usage: tool.name === "notes" ? NOTES_USAGE : HISTORY_USAGE,
							deferLoading: true,
							opaqueResult: true,
						}),
					),
			{ isActive: () => lifecycle.active },
		);
		refreshNested = registration.refresh;
		pi.on("session_shutdown", () => registration.unregister());
		const { withCodexDeveloperMessageDetails } = await import(
			"@howaboua/pi-codex-conversion/developer-messages"
		);
		lifecycle.prepareReminder = withCodexDeveloperMessageDetails;
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
	}
	for (const tool of tools) pi.registerTool(tool);
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
	const route = registerContextSharingService(pi, {
		enabled: () => ready && !unavailable,
		shareSubagentContext: () =>
			lifecycle.active && settings.shareSubagentContext,
		owner: () => owner,
		execute: (ctx, request, signal) =>
			owner.executeShared!(
				{ namespace: request.namespace, params: request.params },
				randomUUID(),
				ctx,
				signal,
			),
	});
	let remote: Pick<
		import("./bridge.js").NotesBridge,
		"lookup" | "canProject" | "projectResult"
	> = {};
	try {
		const { createNotesRemoteService } = await import("./remote.js");
		remote = createNotesRemoteService(pi);
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
	}
	const family = {
		...remote,
		protocol: 1 as const,
		agentName: (ctx: ExtensionContext) => contextAgentIdentity(ctx).agentName,
		route: async (
			query: import("./bridge.js").LookupQuery,
			callId: string,
			ctx: ExtensionContext,
			signal?: AbortSignal,
		) => {
			const identity = contextAgentIdentity(ctx);
			const target = contextTargetAgent(
				query.namespace,
				query.params,
				identity.agentName,
			);
			if (target === identity.agentName) return undefined;
			const result = await route(
				ctx,
				{ ...query, sessionId: identity.sessionId, agentName: target },
				signal,
			);
			if (!result?.details.externalNotesResponses?.length) return result;
			const { externalNotesResponses, ...details } = result.details;
			if (!remote.projectResult || remote.canProject?.(ctx) === false)
				return {
					...result,
					details,
					content: [
						...result.content,
						{
							type: "text" as const,
							text: "Shared encrypted contents are unavailable on this model. Local results remain available. Use a compatible Codex model with PCC for remote contents.",
						},
					],
				};
			return remote.projectResult(
				{ ...result, details },
				externalNotesResponses.map(({ bytesBase64, ...response }) => ({
					...response,
					bytes: Uint8Array.from(Buffer.from(bytesBase64, "base64")),
				})),
				callId,
				ctx,
				signal,
				true,
			);
		},
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
	function applySettings(value: NotesSettings): void {
		settings = value;
		lifecycle.normalCompaction = value.normalCompaction;
		lifecycle.newWindowRequests = value.newWindowRequests;
		lifecycle.idleMinutes = value.idleMinutes;
		lifecycle.taskBoundaryReminder = value.taskBoundaryReminder;
	}
	const markers = registerNoteSaveMarkers(
		pi,
		() => lifecycle.active && settings.noteSaveMarkers,
	);
	pi.on("session_start", (_event, ctx) => {
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
	});
	pi.on("before_agent_start", (event, ctx) => {
		refreshActivation(ctx);
		if (lifecycle.active) {
			markers.bookmark(ctx, lifecycle.windows.current?.currentWindowId);
			return lifecycle.beforeStart(ctx, event);
		}
	});
	pi.on("input", (event, ctx) => {
		refreshActivation(ctx);
		return lifecycle.active ? lifecycle.input(event, ctx) : undefined;
	});
	const nestedWrites = new Map<
		string,
		{ runId: string; windowId: string; parentCallId: string; sessionId: string }
	>();
	pi.on("tool_execution_start", (event, ctx) => {
		if (
			!lifecycle.active ||
			event.toolName !== "notes" ||
			!event.parentToolCallId ||
			!lifecycle.runId ||
			!lifecycle.windows.current
		)
			return;
		const input = event.args as { action?: unknown } | undefined;
		if (input?.action !== "write_file" && input?.action !== "append_to_file")
			return;
		nestedWrites.set(event.toolCallId, {
			runId: lifecycle.runId,
			windowId: lifecycle.windows.current.currentWindowId,
			parentCallId: event.parentToolCallId,
			sessionId: ctx.sessionManager.getSessionId(),
		});
	});
	pi.on("tool_execution_end", (event, ctx) => {
		const write = nestedWrites.get(event.toolCallId);
		nestedWrites.delete(event.toolCallId);
		if (!write || write.sessionId !== ctx.sessionManager.getSessionId()) return;
		const details = event.result?.details;
		pi.appendEntry(NESTED_NOTE_OUTCOME, {
			protocol: 1,
			runId: write.runId,
			windowId: write.windowId,
			callId: event.toolCallId,
			parentCallId: write.parentCallId,
			saved:
				!event.isError &&
				details?.notesCompaction?.saved === true &&
				details.notesCompaction.runId === write.runId,
		} satisfies NestedNoteOutcome);
	});
	pi.on("agent_before_settle", (event) => {
		if (lifecycle.active) lifecycle.outcome(event.outcome);
	});
	pi.on("agent_settled", async (event, ctx) => {
		if (!lifecycle.active) return;
		try {
			markers.record(
				ctx,
				lifecycle.windows.current?.currentWindowId,
				lifecycle.runId,
				event.aborted,
			);
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
						lifecycle.prepareReminder?.(reminder) ?? reminder,
					],
				}
			: undefined;
	});
	pi.on("context", (event, ctx) => {
		try {
			const branch = ctx.sessionManager.getBranch();
			const projected = projectTreeCheckpointBranch(
				branch,
				ctx.sessionManager.getEntries(),
			);
			return {
				messages: owner.projectMessages(
					projectTreeHandoffReads(
						projectTreeCheckpointMessages(branch, projected, event.messages) ??
							event.messages,
						projected,
					),
					projected,
				),
			};
		} catch (error) {
			ctx.abort();
			throw error;
		}
	});
	const prepareCompaction = (
		event: import("@earendil-works/pi-coding-agent").SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	) =>
		ready && !unavailable ? lifecycle.beforeCompact(event, ctx) : undefined;
	try {
		const { registerCompactionPreparation, registerContextBranchProjection } =
			await import("@howaboua/pi-codex-conversion/compaction");
		const registration = registerCompactionPreparation(pi, prepareCompaction);
		const stopProjection = registerContextBranchProjection(
			pi,
			(entries, ctx) =>
				ready && !unavailable
					? projectTreeHandoffBranch(
							lifecycle.windows.projectBranch(
								projectTreeCheckpointBranch(
									entries,
									ctx.sessionManager.getEntries(),
								),
							),
						)
					: entries,
		);
		pi.on("session_shutdown", stopProjection);
		pi.on("session_before_compact", registration.prepare);
		pi.on("session_shutdown", () => registration.dispose());
	} catch (error) {
		if (!optionalPccMissing(error)) throw error;
		pi.on("session_before_compact", prepareCompaction);
	}

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
				if (lifecycle.active) configureTools();
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

function optionalPccMissing(error: unknown): boolean {
	return (
		error instanceof Error &&
		"code" in error &&
		[
			"ERR_MODULE_NOT_FOUND",
			"MODULE_NOT_FOUND",
			"ERR_PACKAGE_PATH_NOT_EXPORTED",
		].includes(String(error.code)) &&
		error.message.includes("@howaboua/pi-codex-conversion")
	);
}
