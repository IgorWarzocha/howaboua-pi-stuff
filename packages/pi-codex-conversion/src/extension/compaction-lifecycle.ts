import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { hasPortableNativeCompactionSummary, isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, NATIVE_COMPACTION_PORTABLE_DISPLAY_TEXT, NATIVE_COMPACTION_STRATEGY, type NativeCompactionDisplayEntry, type NativeCompactionUsage } from "../adapter/compaction/types.ts";
import { findLatestCompactionEntry } from "../adapter/compaction/details-store.ts";
import { handleCodexSessionBeforeCompact } from "../adapter/compaction/compaction.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { formatCompactionCacheDiagnostic } from "../adapter/compaction/diagnostics.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import { isContextWindowCompactionDetails } from "../context-management/messages.ts";
import { hasTreeArchives } from "../context-management/tree-archive.ts";
import type { ExtensionHandler, SessionBeforeCompactEvent, SessionCompactFailedEvent, SessionCompactEvent, SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";

export function createCodexCompactionLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	codeMode: CodeModeRegistration,
	startManualNotesWindow: (ctx: ExtensionContext) => Promise<boolean>,
	refreshNotebookStatus: (ctx: ExtensionContext) => Promise<boolean>,
) {
	const { state } = runtime;

	return {
		beforeCompact: async (event, ctx) => {
			if (state.contextTree.handoff.active) return { cancel: true };
			// Summaries can share the model/session routing; keep the live checkpoint.
			runtime.finishTurn();
			state.cwd = ctx.cwd;
			const plan = resolveCodexRuntimePlanForState(
				ctx,
				state,
			);
			if (event.reason === "manual" && !state.contextWindows.currentIdentity())
				state.contextWindows.ensureInitialized(pi, ctx, plan.contextManagement);
			const contextManagementResult = plan.contextManagement
				? state.contextWindows.prepareCompaction(
					event,
					plan.contextManagementMode,
					plan.compactOnRollover,
				)
				: undefined;
			if (contextManagementResult && "cancel" in contextManagementResult)
				return contextManagementResult;
			if (event.reason !== "manual") runtime.voice.announceContextTransition(event.reason);
			const nativeCompaction = plan.nativeCompaction;
			if (nativeCompaction || plan.contextManagement)
				runtime.voice.compactionStarted();
			try {
				await codeMode.checkpointNotebook();
			} catch (error) {
				ctx.ui.notify(`Notebook checkpoint before compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			if (contextManagementResult) return contextManagementResult;
			if (!nativeCompaction && !plan.nativeReplay && !hasTreeArchives(event.branchEntries)) return undefined;
			try {
				const result = await handleCodexSessionBeforeCompact(
					event,
					ctx,
					state,
					pi,
				);
				if (!result?.compaction) runtime.voice.compactionFinished();
				return result;
			} catch (error) {
				runtime.voice.compactionFinished();
				throw error;
			}
		},
		failed: async (event, ctx) => {
			if (state.contextWindows.isRolloverCompactionRunning()) runtime.autoReasoning.settle(ctx);
			state.pendingPiCompactionNativeWindow = undefined;
			runtime.voice.compactionFinished();
			const plan = resolveCodexRuntimePlanForState(ctx, state);
			const reuseNotes = state.contextWindows.finishManualCheckpointRequest(
				pi, ctx, event, plan.contextManagement && !plan.compactOnRollover,
			);
			if (!reuseNotes) return;
			await startManualNotesWindow(ctx);
		},
		compacted: async (event, ctx) => {
			try {
				runtime.voice.resetContextAnnouncements();
				state.pendingPiCompactionNativeWindow = undefined;
				state.contextWindows.recordCompaction(event.compactionEntry.details);
				const plan = resolveCodexRuntimePlanForState(ctx, state);
				let treeRolloverScheduled = false;
				const contextCompaction =
					event.fromExtension &&
					isContextWindowCompactionDetails(event.compactionEntry.details);
				const compactionEntry = findLatestCompactionEntry(ctx.sessionManager.getBranch());
				if (event.fromExtension && compactionEntry && isNativeCompactionDetails(compactionEntry.details)) {
					const details = compactionEntry.details;
					// Presentation entries persist and render without entering Pi's turn queue or LLM context.
					pi.appendEntry<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, {
						content: hasPortableNativeCompactionSummary(compactionEntry)
							? NATIVE_COMPACTION_PORTABLE_DISPLAY_TEXT
							: NATIVE_COMPACTION_DISPLAY_TEXT,
						compactionEntryId: compactionEntry.id,
					});
					if (details.strategy === NATIVE_COMPACTION_STRATEGY && details.usage) {
						pi.appendEntry<NativeCompactionDisplayEntry>(NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, {
							content: formatCompactionUsage(details.usage),
							compactionEntryId: compactionEntry.id,
							kind: "usage",
						});
					}
				}
				// Overflow compaction keeps the current window and resumes from its checkpoint.
				if (plan.compactOnRollover && event.reason !== "overflow") {
					if (plan.contextManagementMode === "tree" && compactionEntry) {
						const requested = state.contextWindows.isRolloverCompactionRunning();
						treeRolloverScheduled = state.contextTree.schedule(ctx, {
							compactionEntryId: compactionEntry.id,
							triggerTurn: requested,
						});
						if (event.reason === "manual" && !requested) {
							await state.contextTree.settle(pi, ctx);
							treeRolloverScheduled = false;
						}
					} else await state.contextWindows.completeRolloverCompaction(pi, ctx, plan.contextManagementMode);
				}
				if (!treeRolloverScheduled) {
					runtime.resetTransportAfterCompaction(ctx.sessionManager.getSessionId());
					// Tool-requested rollover appends its marker in onComplete; do not prewarm the old window.
					if (!state.contextWindows.isRolloverCompactionRunning() && !state.contextKickoff.pending) {
						// A normal compaction may resume without another kickoff. Prewarm the renewed context too.
						await refreshNotebookStatus(ctx);
						await runtime.startCompactionPrewarm(ctx);
					}
				}
				// Explicit rollover refreshes at its window boundary; overflow stays here.
				if (!contextCompaction && (!plan.compactOnRollover || event.reason === "overflow"))
					await runtime.voice.refreshRealtimeContext(ctx, state.config);
			} finally {
				runtime.voice.compactionFinished();
			}
		},
	} satisfies {
		beforeCompact: ExtensionHandler<SessionBeforeCompactEvent, SessionBeforeCompactResult>;
		failed: ExtensionHandler<SessionCompactFailedEvent>;
		compacted: ExtensionHandler<SessionCompactEvent>;
	};
}

function formatCompactionUsage(usage: NativeCompactionUsage): string {
	const ratio = usage.inputTokens > 0 ? `${((usage.cachedInputTokens / usage.inputTokens) * 100).toFixed(1)}%` : "0%";
	const tokens = (value: number) => Math.round(value).toLocaleString("en-US");
	const diagnostic = formatCompactionCacheDiagnostic(usage, usage.diagnostic);
	return `Compaction V2 · input ${tokens(usage.inputTokens)} · cache read ${tokens(usage.cachedInputTokens)} (${ratio}) · cache write ${tokens(usage.cacheWriteInputTokens)} · output ${tokens(usage.outputTokens)}${diagnostic ? ` ${diagnostic}` : ""}`;
}

