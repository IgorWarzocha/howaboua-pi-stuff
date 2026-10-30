import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { NotesActivation } from "./activation.js";
import type { NotesBridge, NotesOwner } from "./bridge.js";
import { NESTED_NOTE_OUTCOME, type NestedNoteOutcome } from "./fresh-notes.js";
import { registerNotesCompactionIntegration } from "./integrations.js";
import type { NotesLifecycle } from "./lifecycle.js";
import type { registerNoteSaveMarkers } from "./note-save-marker.js";
import { isNoteWrite } from "./query-input.js";
import {
	projectTreeCheckpointBranch,
	projectTreeCheckpointMessages,
} from "./tree-checkpoint.js";
import { projectTreeHandoffReads } from "./tree-handoff-read.js";
import type { WindowCheckpoints } from "./window-checkpoint.js";

export async function registerNotesHooks(
	pi: ExtensionAPI,
	activation: NotesActivation,
	lifecycle: NotesLifecycle,
	owner: NotesOwner,
	checkpoints: WindowCheckpoints,
	markers: ReturnType<typeof registerNoteSaveMarkers>,
	family: NotesBridge,
) {
	pi.on("session_start", async (_event, ctx) => {
		activation.start(ctx, family);
		if (activation.available) {
			try {
				await checkpoints.restore(ctx);
			} catch (error) {
				ctx.ui.notify(`Context checkpoint failed: ${String(error)}`, "error");
			}
		}
	});
	pi.on("before_agent_start", (event, ctx) => {
		activation.refreshActivation(ctx);
		if (lifecycle.active) return lifecycle.beforeStart(ctx, event);
	});
	pi.on("input", async (event, ctx) => {
		activation.refreshActivation(ctx);
		if (activation.available && ctx.isIdle()) {
			try {
				await checkpoints.restore(ctx);
			} catch (error) {
				ctx.ui.notify(`Context checkpoint failed: ${String(error)}`, "error");
				return { action: "handled" };
			}
		}
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
		if (!isNoteWrite(input)) return;
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
			...(details?.notesCompactionRouted === true
				? { origin: "routed" as const }
				: {}),
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
		const checkpoint = event.entries.some(
			(entry) => entry.type === "compaction",
		)
			? undefined
			: checkpoints.draft(ctx.sessionManager.getBranch());
		const entries = checkpoint ? [...event.entries, checkpoint] : event.entries;
		if (!lifecycle.active || lifecycle.newWindowRequests === "off")
			return checkpoint ? { entries } : undefined;
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
			lifecycle.gptPromptMode(),
		);
		return reminder || checkpoint
			? {
					entries: [
						...entries,
						...(reminder
							? [lifecycle.prepareReminder?.(reminder) ?? reminder]
							: []),
					],
				}
			: undefined;
	});
	pi.on("context", (event, ctx) => {
		try {
			if (lifecycle.active)
				markers.bookmark(ctx, lifecycle.windows.current?.currentWindowId);
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
	const prepareProviderWindow = await registerNotesCompactionIntegration(
		pi,
		activation,
		lifecycle,
		checkpoints,
	);
	lifecycle.prepareWindow = async (ctx) => {
		activation.refreshHistorySearch(ctx, true);
		await prepareProviderWindow?.(ctx);
	};
	pi.on("session_compact_failed", async (event, ctx) => {
		if (lifecycle.active) await lifecycle.compactFailed(event, ctx);
	});
	pi.on("session_compact", (_event, ctx) => {
		if (lifecycle.active) {
			lifecycle.windows.restore(ctx.sessionManager.getBranch());
			activation.refreshHistorySearch(ctx, true);
		}
	});
	pi.on("session_tree", (_event, ctx) => {
		lifecycle.reset(ctx);
		activation.refreshHistorySearch(ctx, true);
	});
	pi.on("agent_start", (_event, ctx) =>
		activation.refreshHistorySearch(ctx, true),
	);
	pi.on("model_select", (_event, ctx) => {
		activation.refreshActivation(ctx);
	});
}
