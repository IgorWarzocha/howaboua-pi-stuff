import { randomUUID } from "node:crypto";
import type { NotesOwner } from "./external-notes-protocol.ts";
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
import type { ContextManagementMode, IdleNotesMinutes } from "../adapter/activation/config.ts";
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
	private rolloverCompaction: {
		phase: "scheduled" | "running";
		permission: "off" | "pi-limits" | "unrestricted";
		compact: boolean;
		eligibleSignal?: AbortSignal;
	} | undefined;
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
	private externalOwner: (() => NotesOwner | undefined) | undefined;
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

	setExternalOwner(owner: () => NotesOwner | undefined): void {
		this.externalOwner = owner;
	}

	recordSettlement(pi: ExtensionAPI, ctx: ExtensionContext, aborted: boolean, now = Date.now()): void {
		if (!ctx.isIdle() || !this.identity) return;
		const branch = ctx.sessionManager.getBranch();
		const completed = branch.findLast((entry) => entry.type === "message" && entry.message.role !== "system");
		if (!completed) return;
		pi.appendEntry(IDLE_CHECKPOINT_ENTRY_TYPE, {
			protocol: 1, windowId: this.identity.currentWindowId, completedEntryId: completed.id, settledAt: now, aborted,
		});
	}

	isIdleRolloverDue(ctx: ExtensionContext, minutes: IdleNotesMinutes, now = Date.now()): boolean {
		if (!minutes || !ctx.isIdle() || !this.identity || this.rolloverPending || this.rolloverCompaction) return false;
		const branch = ctx.sessionManager.getBranch();
		// The final reply can precede retries and settled hooks. Only a persisted
		// settlement on this selected run establishes idle age across resume.
		const completed = branch.findLast((entry) => entry.type === "message" && entry.message.role !== "system");
		if (!completed) return false;
		// A tree return may select the final reply before its metadata child. The
		// settlement still proves this exact selected run, never a sibling's run.
		const checkpoint = ctx.sessionManager.getEntries().findLast((entry) => entry.type === "custom" && entry.customType === IDLE_CHECKPOINT_ENTRY_TYPE &&
			entry.data && typeof entry.data === "object" && "completedEntryId" in entry.data && entry.data.completedEntryId === completed.id);
		if (checkpoint?.type !== "custom" || !checkpoint.data || typeof checkpoint.data !== "object") return false;
		const data = checkpoint.data;
		// Escape can arrive after a successful final reply, during before-settle hooks.
		if ("aborted" in data && data.aborted === true) return false;
		return "protocol" in data && data.protocol === 1 && "windowId" in data && data.windowId === this.identity.currentWindowId &&
			"completedEntryId" in data && data.completedEntryId === completed.id && "settledAt" in data &&
			typeof data.settledAt === "number" && Number.isFinite(data.settledAt) && now - data.settledAt >= minutes * 60_000;
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
			if (details.kind === "window" && details.trimPreviousWindow)
				this.trimPendingWindowId = details.currentWindowId;
			this.budget.restore(details.kind, details.currentWindowId);
		}
	}

	ensureInitialized(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		active: boolean,
		{ createIfMissing = true, prepareTurn = false }: { createIfMissing?: boolean; prepareTurn?: boolean } = {},
	): CustomMessageEntryDraft | undefined {
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
		if (!createIfMissing || (!prepareTurn && !branch.some(entry =>
			entry.type === "message" && entry.message.role === "system"))) return;
		const windowId = randomUUID();
		this.identity = {
			firstWindowId: windowId,
			currentWindowId: windowId,
			windowNumber: 0,
			agentName: contextAgentIdentity(ctx).agentName,
		};
		const message = createContextWindowMessage(
			renderContextWindowMessage(this.identity, undefined, this.identity.agentName),
			"window", this.identity,
		);
		if (prepareTurn) return message;
		pi.sendMessage(message, { triggerTurn: false });
	}

	project(
		messages: readonly AgentMessage[],
		mode: ContextManagementMode,
		activeEntries: readonly SessionEntry[] = [],
		allEntries: readonly SessionEntry[] = activeEntries,
	): AgentMessage[] {
		let boundaryIndex = -1;
		let trimBoundaryIndex = -1;
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
			if (message.details.contextManagement.trimPreviousWindow === true) trimBoundaryIndex = index;
			this.identity = identityFromDetails(
				message.details as CodexContextManagementMessageDetails,
				message.content,
			);
		}
		if (boundaryIndex >= 0) this.rolloverPending = undefined;
		let projected = trimBoundaryIndex >= 0 && !hasRealCompactionAfterWindowBoundary(activeEntries)
			? checkpointWindow(messages, trimBoundaryIndex) : [...messages];
		if (mode !== "off" && this.identity)
			projected = restoreCompactedIdentity(projected, activeEntries, this.identity);
		if (mode === "tree") return filterTreeArchiveSummaries(projected, buildTreeArchiveIndex(allEntries, activeEntries));
		return mode === "off" ? projected.filter((message) =>
			message.role !== "custom" || message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE) : projected;
	}

	scheduleRolloverCompaction(permission: "off" | "pi-limits" | "unrestricted" = "unrestricted", compact = true): boolean {
		if (this.rolloverCompaction || this.rolloverPending) return false;
		this.rolloverCompaction = { phase: "scheduled", permission, compact };
		return true;
	}

	cancelScheduledCompaction(): void {
		if (this.rolloverCompaction?.phase === "scheduled") this.rolloverCompaction = undefined;
	}

	finishTurn(ctx: ExtensionContext, continueWindow: (outcome: "compacted" | "notes-only" | "no-work") => Promise<unknown>, continueSameWindow: () => void): boolean {
		if (!this.rolloverCompaction) return false;
		if (this.rolloverCompaction.phase === "running") return true;
		const pending = this.rolloverCompaction;
		const sessionId = ctx.sessionManager.getSessionId();
		const windowId = this.identity?.currentWindowId;
		const current = () => this.rolloverCompaction === pending && ctx.sessionManager.getSessionId() === sessionId && this.identity?.currentWindowId === windowId;
		const open = (outcome: "compacted" | "notes-only" | "no-work") => {
			if (!current()) return;
			this.rolloverCompaction = undefined;
			void continueWindow(outcome).catch((error: unknown) => {
				ctx.ui.notify(`Context rollover failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			});
		};
		pending.phase = "running";
		// Pi compaction aborts and waits for the loop; the turn hook must return first.
		ctx.compact({
			onComplete: () => {
				open("compacted");
			},
			onError: (error) => {
				if (!current()) return;
				if (pending.eligibleSignal && !pending.eligibleSignal.aborted && error.message === "Compaction cancelled") {
					open("notes-only");
					return;
				}
				// Pi exposes no typed no-work outcome. Do not classify other cancellations or failures.
				if (error.message === "Already compacted" || error.message === "Nothing to compact (session too small)") {
					if (pending.permission === "unrestricted") open("no-work");
					else {
						this.rolloverCompaction = undefined;
						continueSameWindow();
					}
					return;
				}
				this.rolloverCompaction = undefined;
				ctx.ui.notify(`Context rollover failed: ${error.message}`, "error");
			},
		});
		return true;
	}

	isRolloverCompactionRunning(): boolean {
		return this.rolloverCompaction?.phase === "running";
	}

	async startNewWindow(
		ctx: ExtensionContext,
		options: StartContextWindowOptions,
	): Promise<CustomMessageEntryDraft | undefined> {
		if (this.rolloverPending || options.signal?.aborted) return;
		const pending = {};
		this.rolloverPending = pending;
		try {
			const current = this.identity;
			const threadHint = current && options.mode
				? await this.loadThreadHint(ctx, options.mode, options.signal)
				: undefined;
			if (this.rolloverPending !== pending || options.signal?.aborted) {
				if (this.rolloverPending === pending) this.rolloverPending = undefined;
				return;
			}
			await this.beforeWindowStart?.(ctx, options);
			if (this.rolloverPending !== pending || options.signal?.aborted) {
				if (this.rolloverPending === pending) this.rolloverPending = undefined;
				return;
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
			return this.prepareWindowMessage(ctx, next, options, threadHint);
		} catch (error) {
			if (this.rolloverPending === pending) this.rolloverPending = undefined;
			throw error;
		}
	}

	recordBudget(
		ctx: ExtensionContext,
		mode: ContextManagementMode,
		contextTokens?: number,
		taskBoundaryReminder = 0,
	): CustomMessageEntryDraft | undefined {
		if (mode === "off" || !this.identity || this.rolloverPending) return;
		const reminder = (!hasFreshContextNotes(ctx.sessionManager.getBranch(), this.identity.currentWindowId, mode, false)
			? this.budget.record(ctx, this.identity, contextTokens) : undefined)
			?? (taskBoundaryReminder ? this.budget.recordTaskBoundary(ctx, this.identity, contextTokens, taskBoundaryReminder) : undefined);
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
		if (event.reason === "manual" && this.rolloverCompaction?.phase === "running") {
			if (this.rolloverCompaction.compact) return undefined;
			this.rolloverCompaction.eligibleSignal = event.signal;
			return { cancel: true };
		}
		if (compactOnRollover) return undefined;
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
		this.promptNotesCheckpoint(pi, ctx, pending.mode, pending.customInstructions);
		return false;
	}

	promptNotesCheckpoint(
		pi: ExtensionAPI,
		ctx: Pick<ExtensionContext, "isIdle" | "ui" | "sessionManager">,
		mode: ContextManagementMode,
		customInstructions?: string,
	): void {
		if (!this.identity || this.promptedManualCheckpoint) throw new Error("A context checkpoint cannot start yet");
		const idle = ctx.isIdle();
		const reminder = createContextWindowMessage(renderManualContextCheckpoint(customInstructions),
			"reminder", this.identity);
		const checkpoint = this.promptedManualCheckpoint = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.identity.currentWindowId,
			reminderId: reminder.details.id,
			mode,
			phase: idle ? "awaiting" : "running",
		};
		try {
			pi.sendMessage(reminder, { deliverAs: "steer", triggerTurn: true });
		} catch (error) {
			if (this.promptedManualCheckpoint === checkpoint) this.promptedManualCheckpoint = undefined;
			throw error;
		}
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
			this.budget.resetThresholds();
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
		const owner = this.externalOwner?.();
		return rewriteWindowPayload(payload, ctx, owner ? owner.identity(ctx) : this.identity, !owner);
	}

	rewriteHeaders(headers: ProviderHeaders, ctx: ExtensionContext): void {
		const owner = this.externalOwner?.();
		rewriteWindowHeaders(headers, ctx, owner ? owner.identity(ctx) : this.identity, !owner);
	}

	private prepareWindowMessage(
		ctx: ExtensionContext,
		identity: ContextWindowIdentity,
		options: StartContextWindowOptions,
		threadHint?: string,
	): CustomMessageEntryDraft {
		identity = { ...identity, agentName: contextAgentIdentity(ctx).agentName };
		this.identity = identity;
		if (options.trimPreviousWindow) this.trimPendingWindowId = identity.currentWindowId;
		return createContextWindowMessage(
			renderContextWindowMessage(identity, threadHint, identity.agentName),
			"window",
			identity,
			options.trimPreviousWindow,
		);
	}

}

/** Apply the same explicit retirement boundary to compaction and native replay. */
export function projectContextWindowBranch(entries: SessionEntry[]): SessionEntry[] {
	const boundary = entries.findLast(entry => entry.type === "custom_message" &&
		entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE && isCodexContextManagementMessageDetails(entry.details) &&
		entry.details.contextManagement.kind === "window" && entry.details.contextManagement.trimPreviousWindow === true);
	return boundary && !hasRealCompactionAfterWindowBoundary(entries)
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
			entry.details.contextManagement.kind === "window" && entry.details.contextManagement.trimPreviousWindow === true
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

function restoreCompactedIdentity(messages: AgentMessage[], entries: readonly SessionEntry[], identity: ContextWindowIdentity): AgentMessage[] {
	const summary = messages.findIndex(message => message.role === "compactionSummary");
	if (summary < 0 || messages[0]?.role !== "system" || messages.some(message => message.role === "custom" && message.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
		isCodexContextManagementMessageDetails(message.details) &&
		(message.details.contextManagement.kind === "window" || message.details.contextManagement.kind === "identity") &&
		message.details.contextManagement.currentWindowId === identity.currentWindowId)) return messages;
	const compaction = entries.findLast(entry => entry.type === "compaction");
	const source = entries.findLast(entry => entry.type === "custom_message" && entry.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
		isCodexContextManagementMessageDetails(entry.details) &&
		(entry.details.contextManagement.kind === "window" || entry.details.contextManagement.kind === "identity") &&
		entry.details.contextManagement.currentWindowId === identity.currentWindowId);
	if (!compaction || source?.type !== "custom_message" || typeof source.content !== "string" || !isCodexContextManagementMessageDetails(source.details)) return messages;
	const { trimPreviousWindow: _trim, ...contextManagement } = source.details.contextManagement;
	// Carry the older identity ahead of its summary, outside opaque native replay.
	const restored: AgentMessage = {
		role: "custom", customType: CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
		content: `${source.content}\n\nIf no checkpoint is available, use history to recover missing context.`,
		display: false, timestamp: messages[summary]!.timestamp,
		details: { ...source.details, id: `${compaction.id}:identity`, contextManagement: { ...contextManagement, kind: "identity" } } satisfies CodexContextManagementMessageDetails,
	};
	return [...messages.slice(0, summary), restored, ...messages.slice(summary)];
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
