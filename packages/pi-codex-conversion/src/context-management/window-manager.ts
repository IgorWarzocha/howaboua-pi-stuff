import { randomUUID } from "node:crypto";
import { contextAgentIdentity } from "./agent-identity.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { getCurrentSystemMessage, type ProviderHeaders } from "@earendil-works/pi-ai";
import { ContextWindowBudget, type ContextRemaining } from "./window-budget.ts";
import { rewriteWindowPayload, rewriteWindowHeaders } from "./window-request.ts";
import type {
	CompactionResult,
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
	ExtensionEvent,
	SessionBeforeCompactEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { tryStartCodexPreparedIdleKickoff } from "../developer-messages.ts";
import { loadHistoryNotesThreadHint } from "./history-notes.ts";
import { hasFreshContextNotes } from "./saved-notes.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_STRATEGY,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
	type CodexContextManagementMessageDetails,
	type ContextWindowCompactionDetails,
	type ContextWindowIdentity,
	isCodexContextManagementMessageDetails,
	isContextWindowBoundary,
	isContextWindowCompactionDetails,
	renderContextWindowMessage,
	renderManualContextCheckpoint,
	createContextWindowMessage,
} from "./messages.ts";
import {
	buildTreeArchiveIndex,
	filterTreeArchiveSummaries,
} from "./tree-archive.ts";

export interface StartContextWindowOptions {
	signal?: AbortSignal | undefined;
	mode?: ContextManagementMode | undefined;
	trimPreviousWindow: boolean;
	sourceLeafId?: string | undefined;
}

type ThreadHintLoader = (
	ctx: ExtensionContext,
	mode: ContextManagementMode,
	signal?: AbortSignal,
) => Promise<string | undefined>;

const IDLE_CHECKPOINT_ENTRY_TYPE = "codex-context-idle-checkpoint";

export class CodexContextWindowManager {
	private identity: ContextWindowIdentity | undefined;
	private readonly budget = new ContextWindowBudget();
	private rolloverPending: object | undefined;
	private rolloverCompaction: { phase: "scheduled" | "running" } | undefined;
	private manualCheckpoint: {
		identity: ContextWindowIdentity;
		mode: ContextManagementMode;
		customInstructions: string | undefined;
		signal: AbortSignal;
	} | undefined;
	private promptedManualCheckpoint: {
		sessionId: string;
		windowId: string;
		reminderId: string;
		mode: ContextManagementMode;
		phase: "awaiting" | "running";
	} | undefined;
	private trimPendingWindowId: string | undefined;
	private readonly loadThreadHint: ThreadHintLoader;
	private readonly beforeWindowStart: ((ctx: ExtensionContext, options: Pick<StartContextWindowOptions, "sourceLeafId" | "signal">) => Promise<void>) | undefined;

	constructor(
		loadThreadHint: ThreadHintLoader = loadHistoryNotesThreadHint,
		beforeWindowStart?: (ctx: ExtensionContext, options: Pick<StartContextWindowOptions, "sourceLeafId" | "signal">) => Promise<void>,
	) {
		this.loadThreadHint = loadThreadHint;
		this.beforeWindowStart = beforeWindowStart;
	}

	reset(): void {
		this.identity = undefined;
		this.budget.reset();
		this.rolloverPending = undefined;
		this.rolloverCompaction = undefined;
		this.manualCheckpoint = undefined;
		this.promptedManualCheckpoint = undefined;
		this.trimPendingWindowId = undefined;
	}

	currentIdentity(): ContextWindowIdentity | undefined {
		return this.identity ? { ...this.identity } : undefined;
	}

	recordSettledCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext, mode: ContextManagementMode, now = Date.now()): void {
		if (!ctx.isIdle() || !this.identity) return;
		const branch = ctx.sessionManager.getBranch();
		if (!hasFreshContextNotes(branch, this.identity.currentWindowId, mode, true)) return;
		const completed = branch.findLast((entry) => entry.type === "message" && entry.message.role !== "system");
		if (!completed) return;
		pi.appendEntry(IDLE_CHECKPOINT_ENTRY_TYPE, {
			protocol: 1, windowId: this.identity.currentWindowId, completedEntryId: completed.id, settledAt: now,
		});
	}

	hasIdleNotesCheckpoint(ctx: ExtensionContext, mode: ContextManagementMode, now = Date.now()): boolean {
		if (!ctx.isIdle() || !this.identity || this.rolloverPending || this.rolloverCompaction) return false;
		const branch = ctx.sessionManager.getBranch();
		if (!hasFreshContextNotes(branch, this.identity.currentWindowId, mode, true)) return false;
		// The final reply can precede retries and settled hooks. Only a persisted
		// settlement on this selected run establishes idle age across resume.
		const completed = branch.findLast((entry) => entry.type === "message" && entry.message.role !== "system");
		if (completed?.type !== "message" || completed.message.role !== "assistant" || completed.message.stopReason !== "stop") return false;
		// A tree return may select the final reply before its metadata child. The
		// settlement still proves this exact selected run, never a sibling's run.
		const checkpoint = ctx.sessionManager.getEntries().findLast((entry) => entry.type === "custom" && entry.customType === IDLE_CHECKPOINT_ENTRY_TYPE &&
			entry.data && typeof entry.data === "object" && "completedEntryId" in entry.data && entry.data.completedEntryId === completed.id);
		if (checkpoint?.type !== "custom" || !checkpoint.data || typeof checkpoint.data !== "object") return false;
		const data = checkpoint.data;
		return "protocol" in data && data.protocol === 1 && "windowId" in data && data.windowId === this.identity.currentWindowId &&
			"completedEntryId" in data && data.completedEntryId === completed.id && "settledAt" in data &&
			typeof data.settledAt === "number" && Number.isFinite(data.settledAt) && now - data.settledAt >= 25 * 60_000;
	}

	restore(entries: readonly SessionEntry[]): void {
		this.reset();
		for (const entry of entries) {
			if (entry.type === "compaction") {
				this.recordCompaction(entry.details);
				continue;
			}
			if (
				entry.type !== "custom_message" ||
				entry.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE ||
				!isCodexContextManagementMessageDetails(entry.details)
			)
				continue;
			const details = entry.details.contextManagement;
			if (details.kind === "window" || details.kind === "identity")
				this.identity = identityFromDetails(entry.details, entry.content);
			if (details.kind === "window") {
				this.trimPendingWindowId = details.trimPreviousWindow
					? details.currentWindowId
					: undefined;
			}
			this.budget.restore(details.kind, details.currentWindowId);
		}
	}

	ensureInitialized(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		active: boolean,
	): void {
		if (!active) return;
		const pending = this.promptedManualCheckpoint;
		const branch = ctx.sessionManager.getBranch();
		this.restore(branch);
		if (pending && pending.sessionId === ctx.sessionManager.getSessionId() &&
			pending.windowId === this.identity?.currentWindowId && branch.some((entry) =>
				entry.type === "custom_message" && entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
				isCodexContextManagementMessageDetails(entry.details) && entry.details.id === pending.reminderId))
			this.promptedManualCheckpoint = pending;
		if (this.identity) {
			const agentName = contextAgentIdentity(ctx).agentName;
			if (this.identity.agentName && this.identity.agentName !== agentName) {
				this.identity = { ...this.identity, agentName };
				// Correct a fork's name without moving its retirement boundary or resetting its budget.
				pi.sendMessage(createContextWindowMessage(
					renderContextWindowMessage(this.identity, undefined, agentName), "identity", this.identity,
				), { triggerTurn: false });
			}
			return;
		}
		const windowId = randomUUID();
		this.sendWindowMessage(
			pi,
			ctx,
			{
				firstWindowId: windowId,
				currentWindowId: windowId,
				windowNumber: 0,
			},
			{ trimPreviousWindow: false },
		);
	}

	project(
		messages: readonly AgentMessage[],
		mode: ContextManagementMode,
		activeEntries: readonly SessionEntry[] = [],
		allEntries: readonly SessionEntry[] = activeEntries,
	): AgentMessage[] {
		let boundaryIndex = -1;
		let trimPreviousWindow = false;
		for (let index = 0; index < messages.length; index += 1) {
			const message = messages[index]!;
			if (
				message.role === "custom" &&
				message.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
				!isCodexContextManagementMessageDetails(message.details)
			)
				throw new Error("Malformed persisted Codex context-window message");
			if (message.role === "custom" && message.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
				isCodexContextManagementMessageDetails(message.details) && message.details.contextManagement.kind === "identity")
				this.identity = identityFromDetails(message.details, message.content);
			if (!isContextWindowBoundary(message)) continue;
			boundaryIndex = index;
			trimPreviousWindow = message.details.contextManagement.trimPreviousWindow === true;
			this.identity = identityFromDetails(
				message.details as CodexContextManagementMessageDetails,
				message.content,
			);
		}
		if (boundaryIndex >= 0) this.rolloverPending = undefined;
		const projected = trimPreviousWindow && boundaryIndex >= 0 && !hasRealCompactionAfterWindowBoundary(activeEntries)
			? checkpointWindow(messages, boundaryIndex) : [...messages];
		if (mode === "tree") return filterTreeArchiveSummaries(projected, buildTreeArchiveIndex(allEntries, activeEntries));
		return mode === "off" ? projected.filter((message) =>
			message.role !== "custom" || message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE) : projected;
	}

	scheduleRolloverCompaction(): boolean {
		if (this.rolloverCompaction || this.rolloverPending) return false;
		this.rolloverCompaction = { phase: "scheduled" };
		return true;
	}

	cancelScheduledCompaction(): void {
		if (this.rolloverCompaction?.phase === "scheduled") this.rolloverCompaction = undefined;
	}

	finishTurn(ctx: ExtensionContext, continueWindow: () => Promise<unknown>): boolean {
		if (!this.rolloverCompaction) return false;
		if (this.rolloverCompaction.phase === "running") return true;
		const pending = this.rolloverCompaction;
		pending.phase = "running";
		// Pi compaction aborts and waits for the loop; the turn hook must return first.
		ctx.compact({
			onComplete: () => {
				if (this.rolloverCompaction !== pending) return;
				this.rolloverCompaction = undefined;
				void continueWindow().catch((error: unknown) => {
					ctx.ui.notify(`Compaction completed, but context rollover failed: ${error instanceof Error ? error.message : String(error)}`, "error");
				});
			},
			onError: (error) => {
				if (this.rolloverCompaction !== pending) return;
				this.rolloverCompaction = undefined;
				ctx.ui.notify(`Context rollover failed: ${error.message}`, "error");
			},
		});
		return true;
	}

	async completeRolloverCompaction(pi: ExtensionAPI, ctx: ExtensionContext, mode: ContextManagementMode): Promise<void> {
		if (this.isRolloverCompactionRunning()) return;
		this.cancelScheduledCompaction();
		await this.startNewWindow(pi, ctx, {
			mode, trimPreviousWindow: false,
		});
	}

	isRolloverCompactionRunning(): boolean {
		return this.rolloverCompaction?.phase === "running";
	}

	async startNewWindow(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		options: StartContextWindowOptions,
	): Promise<boolean> {
		if (this.rolloverPending || options.signal?.aborted) return false;
		const pending = {};
		this.rolloverPending = pending;
		try {
			const current = this.identity;
			const threadHint = current && options.mode
				? await this.loadThreadHint(ctx, options.mode, options.signal)
				: undefined;
			if (this.rolloverPending !== pending || options.signal?.aborted) {
				if (this.rolloverPending === pending) this.rolloverPending = undefined;
				return false;
			}
			await this.beforeWindowStart?.(ctx, options);
			if (this.rolloverPending !== pending || options.signal?.aborted) {
				if (this.rolloverPending === pending) this.rolloverPending = undefined;
				return false;
			}
			const currentWindowId = randomUUID();
			const next: ContextWindowIdentity = current
				? {
						firstWindowId: current.firstWindowId,
						currentWindowId,
						previousWindowId: current.currentWindowId,
						windowNumber: current.windowNumber + 1,
					}
					: {
						firstWindowId: currentWindowId,
						currentWindowId,
						windowNumber: 0,
					};
			this.sendWindowMessage(pi, ctx, next, options, threadHint);
			return true;
		} catch (error) {
			if (this.rolloverPending === pending) this.rolloverPending = undefined;
			throw error;
		}
	}

	recordBudget(
		ctx: ExtensionContext,
		mode: ContextManagementMode,
		contextTokens?: number,
	): CustomMessageEntryDraft | undefined {
		if (mode === "off" || !this.identity || this.rolloverPending) return;
		if (hasFreshContextNotes(ctx.sessionManager.getBranch(), this.identity.currentWindowId, mode, false)) return;
		const reminder = this.budget.record(ctx, this.identity, contextTokens);
		if (reminder) return createContextWindowMessage(reminder.content, reminder.kind, this.identity);
	}

	remaining(ctx: ExtensionContext, contextTokens?: number): ContextRemaining {
		return this.budget.remaining(ctx, this.identity, contextTokens);
	}

	prepareCompaction(
		event: SessionBeforeCompactEvent,
		mode: ContextManagementMode,
		compactOnRollover = false,
	):
		| { cancel: true }
		| { compaction: CompactionResult<ContextWindowCompactionDetails> }
		| undefined {
		if (compactOnRollover) return event.reason === "threshold" ? { cancel: true } : undefined;
		if (event.reason === "overflow") return undefined;
		if (event.reason === "manual") {
			this.promptedManualCheckpoint = undefined;
			if (!this.identity) return { cancel: true };
			this.manualCheckpoint = {
				identity: { ...this.identity },
				mode,
				customInstructions: event.customInstructions,
				signal: event.signal,
			};
			return { cancel: true };
		}
		if (event.reason === "threshold") {
			if (mode === "tree") return { cancel: true };
			const boundary = findLatestWindowBoundaryEntry(event.branchEntries);
			if (
				!boundary ||
				boundary.details.contextManagement.currentWindowId !==
					this.trimPendingWindowId
			)
				return { cancel: true };
		}
		return { compaction: this.createCompaction(event) };
	}

	finishManualCheckpointRequest(pi: ExtensionAPI, ctx: Pick<ExtensionContext, "isIdle" | "ui" | "sessionManager">, event: Extract<ExtensionEvent, { type: "session_compact_failed" }>, active: boolean): boolean {
		const pending = this.manualCheckpoint;
		this.manualCheckpoint = undefined;
		if (
			!pending || !active || event.reason !== "manual" || !event.aborted ||
			pending.signal.aborted || pending.identity.currentWindowId !== this.identity?.currentWindowId
		) return false;
		// Pi clears its manual compaction controller before session_compact_failed.
		const idle = ctx.isIdle();
		if (idle && !pending.customInstructions?.trim() && hasFreshContextNotes(
			ctx.sessionManager.getBranch(), pending.identity.currentWindowId, pending.mode, true,
		)) return true;
		const reminder = createContextWindowMessage(renderManualContextCheckpoint(pending.customInstructions),
			"reminder", pending.identity);
		const checkpoint = this.promptedManualCheckpoint = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: pending.identity.currentWindowId,
			reminderId: reminder.details.id,
			mode: pending.mode,
			phase: idle ? "awaiting" : "running",
		};
		try {
			pi.sendMessage(reminder, idle ? { triggerTurn: false } : { deliverAs: "steer", triggerTurn: true });
			if (idle && !tryStartCodexPreparedIdleKickoff(pi, ctx))
				pi.sendUserMessage("Continue.", { deliverAs: "steer" });
		} catch (error) {
			if (this.promptedManualCheckpoint === checkpoint) this.promptedManualCheckpoint = undefined;
			throw error;
		}
		return false;
	}

	beginPromptedManualCheckpointRun(): void {
		if (this.promptedManualCheckpoint?.phase === "awaiting")
			this.promptedManualCheckpoint.phase = "running";
	}

	finishPromptedManualCheckpoint(ctx: Pick<ExtensionContext, "sessionManager">, active: boolean): "ready" | "missing" | undefined {
		const pending = this.promptedManualCheckpoint;
		if (!pending || pending.phase !== "running") return;
		this.promptedManualCheckpoint = undefined;
		if (!active || pending.sessionId !== ctx.sessionManager.getSessionId() ||
			pending.windowId !== this.identity?.currentWindowId) return;
		return hasFreshContextNotes(ctx.sessionManager.getBranch(), pending.windowId, pending.mode, true)
			? "ready" : "missing";
	}

	recordCompaction(details: unknown): void {
		if (!isContextWindowCompactionDetails(details)) {
			this.budget.reset();
			// A real checkpoint supersedes any pending notes-only trim.
			this.trimPendingWindowId = undefined;
		} else if (details.windowId === this.trimPendingWindowId)
			this.trimPendingWindowId = undefined;
	}

	createCompaction(
		event: SessionBeforeCompactEvent,
	): CompactionResult<ContextWindowCompactionDetails> {
		const boundary = findLatestWindowBoundaryEntry(event.branchEntries);
		return {
			summary: CONTEXT_WINDOW_COMPACTION_SUMMARY,
			firstKeptEntryId:
				boundary?.id ?? event.preparation.firstKeptEntryId,
			tokensBefore: event.preparation.tokensBefore,
			details: {
				protocol: 1,
				strategy: CONTEXT_WINDOW_COMPACTION_STRATEGY,
				...(this.identity
					? { windowId: this.identity.currentWindowId }
					: {}),
			},
		};
	}

	rewritePayload(payload: unknown, ctx: ExtensionContext): unknown {
		return rewriteWindowPayload(payload, ctx, this.identity);
	}

	rewriteHeaders(headers: ProviderHeaders, ctx: ExtensionContext): void {
		rewriteWindowHeaders(headers, ctx, this.identity);
	}

	private sendWindowMessage(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		identity: ContextWindowIdentity,
		options: StartContextWindowOptions,
		threadHint?: string,
	): void {
		identity = { ...identity, agentName: contextAgentIdentity(ctx).agentName };
		this.identity = identity;
		this.trimPendingWindowId = options.trimPreviousWindow
			? identity.currentWindowId
			: undefined;
		pi.sendMessage(createContextWindowMessage(
			renderContextWindowMessage(identity, threadHint, identity.agentName),
			"window",
			identity,
			options.trimPreviousWindow,
		), { triggerTurn: false });
	}

}

/** Apply the same explicit retirement boundary to compaction and native replay. */
export function projectContextWindowBranch(entries: SessionEntry[]): SessionEntry[] {
	const boundary = findLatestWindowBoundaryEntry(entries);
	return boundary?.details.contextManagement.trimPreviousWindow && !hasRealCompactionAfterWindowBoundary(entries)
		? entries.slice(entries.indexOf(boundary)) : entries;
}

function hasRealCompactionAfterWindowBoundary(entries: readonly SessionEntry[]): boolean {
	let boundaryIndex = -1;
	let compactionIndex = -1;
	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index]!;
		if (
			entry.type === "custom_message" &&
			entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
			isCodexContextManagementMessageDetails(entry.details) &&
			entry.details.contextManagement.kind === "window"
		) boundaryIndex = index;
		if (entry.type === "compaction" && !isContextWindowCompactionDetails(entry.details))
			compactionIndex = index;
	}
	return boundaryIndex >= 0 && compactionIndex > boundaryIndex;
}

/** An explicit window cut retires conversation, not the prompt and executable tool declarations. */
function checkpointWindow(messages: readonly AgentMessage[], boundaryIndex: number): AgentMessage[] {
	const checkpoint = getCurrentSystemMessage(messages.slice(0, boundaryIndex));
	const tail = messages.slice(boundaryIndex);
	return checkpoint ? [checkpoint, ...tail] : tail;
}

function identityFromDetails(
	details: CodexContextManagementMessageDetails,
	content?: unknown,
): ContextWindowIdentity {
	const context = details.contextManagement;
	const agentName = context.agentName ?? (typeof content === "string"
		? /^Agent name: (\/root(?:\/[a-zA-Z0-9_-]+)*)$/m.exec(content)?.[1] : undefined);
	return {
		...(agentName ? { agentName } : {}),
		firstWindowId: context.firstWindowId,
		currentWindowId: context.currentWindowId,
		...(context.previousWindowId
			? { previousWindowId: context.previousWindowId }
			: {}),
		windowNumber: context.windowNumber,
	};
}

export function findLatestWindowBoundaryEntry(
	entries: readonly SessionEntry[],
): (Extract<SessionEntry, { type: "custom_message" }> & {
	details: CodexContextManagementMessageDetails;
}) | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index]!;
		if (
			entry.type === "custom_message" &&
			entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
			isCodexContextManagementMessageDetails(entry.details) &&
			entry.details.contextManagement.kind === "window"
		)
			return entry as Extract<SessionEntry, { type: "custom_message" }> & {
				details: CodexContextManagementMessageDetails;
			};
	}
	return undefined;
}
