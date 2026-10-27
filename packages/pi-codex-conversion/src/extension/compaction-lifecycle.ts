import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { resolveCodexRuntimePlanForState } from "../adapter/activation/runtime-plan.ts";
import { hasPortableNativeCompactionSummary, isNativeCompactionDetails, NATIVE_COMPACTION_DISPLAY_MESSAGE_TYPE, NATIVE_COMPACTION_DISPLAY_TEXT, NATIVE_COMPACTION_PORTABLE_DISPLAY_TEXT, NATIVE_COMPACTION_STRATEGY, type NativeCompactionDisplayEntry, type NativeCompactionUsage } from "../adapter/compaction/types.ts";
import { findLatestCompactionEntry } from "../adapter/compaction/details-store.ts";
import { handleCodexSessionBeforeCompact } from "../adapter/compaction/compaction.ts";
import type { CodeModeRegistration } from "../tools/code-mode/tools.ts";
import { formatCompactionCacheDiagnostic } from "../adapter/compaction/diagnostics.ts";
import type { CodexExtensionRuntime } from "./runtime.ts";
import { prepareExtensionCompaction, registerContextWindowPreparation } from "../compaction.ts";
import type { ExtensionHandler, SessionBeforeCompactEvent, SessionCompactFailedEvent, SessionCompactEvent, SessionBeforeCompactResult } from "@earendil-works/pi-coding-agent";

export function createCodexCompactionLifecycle(
	pi: ExtensionAPI,
	runtime: CodexExtensionRuntime,
	codeMode: CodeModeRegistration,
	refreshNotebookStatus: (ctx: ExtensionContext) => Promise<boolean>,
) {
	const { state } = runtime;
	const stopWindowPreparation = registerContextWindowPreparation(pi, async ctx => {
		runtime.voice.announceContextTransition("rollover");
		await runtime.voice.refreshRealtimeContext(ctx, state.config);
		// Notes-only rollover does not emit session_compact. Retire the outgoing
		// transport lane here too, including its temporary SSE fallback.
		runtime.resetTransportForContextWindow(ctx.sessionManager.getSessionId());
	});
	pi.on("session_shutdown", stopWindowPreparation);

	return {
		beforeCompact: async (event, ctx) => {
			try {
				const prepared = await prepareExtensionCompaction(pi, event, ctx);
				if (prepared?.cancel || prepared?.compaction) return prepared;
			} catch (error) {
				ctx.ui.notify(`Compaction preparation failed: ${error instanceof Error ? error.message : String(error)}. The existing context remains.`, "error");
				return { cancel: true };
			}
			// Compaction can resume this run without another agent_start.
			runtime.suspendOrdinaryPrewarm();
			state.cwd = ctx.cwd;
			const plan = resolveCodexRuntimePlanForState(
				ctx,
				state,
			);
			if (event.reason !== "manual") runtime.voice.announceContextTransition(event.reason);
			const nativeCompaction = plan.nativeCompaction;
			if (nativeCompaction)
				runtime.voice.compactionStarted();
			try {
				await codeMode.checkpointNotebook();
			} catch (error) {
				ctx.ui.notify(`Notebook checkpoint before compaction failed: ${error instanceof Error ? error.message : String(error)}`, "warning");
			}
			if (!nativeCompaction && !plan.nativeReplay) return undefined;
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
		failed: async () => {
			state.pendingPiCompactionNativeWindow = undefined;
			runtime.voice.compactionFinished();
		},
		compacted: async (event, ctx) => {
			try {
				runtime.voice.resetContextAnnouncements();
				state.pendingPiCompactionNativeWindow = undefined;
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
				runtime.resetTransportForContextWindow(ctx.sessionManager.getSessionId());
				await refreshNotebookStatus(ctx);
				// Pi has not run the next context chain yet. Warm only its final request.
				runtime.prepareTurn(ctx);
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

