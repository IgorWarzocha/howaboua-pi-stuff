import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import { ContextWindowBudget, type ContextRemaining } from "./window-budget.ts";
import { rewriteWindowPayload, rewriteWindowHeaders } from "./window-request.ts";
import type {
	CompactionResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { loadHistoryNotesThreadHint } from "./history-notes.ts";
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
	sendContextWindowMessage,
} from "./messages.ts";
import {
	buildTreeArchiveIndex,
	filterTreeArchiveSummaries,
} from "./tree-archive.ts";

interface StartContextWindowOptions {
	triggerTurn: boolean;
	signal?: AbortSignal | undefined;
	mode?: ContextManagementMode | undefined;
	trimPreviousWindow: boolean;
}

type ThreadHintLoader = (
	ctx: ExtensionContext,
	mode: ContextManagementMode,
	signal?: AbortSignal,
) => Promise<string | undefined>;

export class CodexContextWindowManager {
	private identity: ContextWindowIdentity | undefined;
	private readonly budget = new ContextWindowBudget();
	private rolloverPending = false;
	private trimPendingWindowId: string | undefined;
	private readonly loadThreadHint: ThreadHintLoader;

	constructor(loadThreadHint: ThreadHintLoader = loadHistoryNotesThreadHint) {
		this.loadThreadHint = loadThreadHint;
	}

	reset(): void {
		this.identity = undefined;
		this.budget.reset();
		this.rolloverPending = false;
		this.trimPendingWindowId = undefined;
	}

	currentIdentity(): ContextWindowIdentity | undefined {
		return this.identity ? { ...this.identity } : undefined;
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
			if (details.kind === "window") {
				this.identity = identityFromDetails(entry.details);
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
		this.restore(ctx.sessionManager.getBranch());
		if (this.identity) return;
		const windowId = randomUUID();
		this.sendWindowMessage(
			pi,
			{
				firstWindowId: windowId,
				currentWindowId: windowId,
				windowNumber: 0,
			},
			{ triggerTurn: false, trimPreviousWindow: false },
		);
	}

	project(
		messages: readonly AgentMessage[],
		mode: ContextManagementMode,
		activeEntries: readonly SessionEntry[] = [],
		allEntries: readonly SessionEntry[] = activeEntries,
	): AgentMessage[] {
		if (mode === "off")
			return messages.filter(
				(message) =>
					message.role !== "custom" ||
					message.customType !== CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
			);
		let boundaryIndex = -1;
		for (let index = 0; index < messages.length; index += 1) {
			const message = messages[index]!;
			if (
				message.role === "custom" &&
				message.customType === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE &&
				!isCodexContextManagementMessageDetails(message.details)
			)
				throw new Error("Malformed persisted Codex context-window message");
			if (!isContextWindowBoundary(message)) continue;
			boundaryIndex = index;
			this.identity = identityFromDetails(
				message.details as CodexContextManagementMessageDetails,
			);
		}
		if (mode === "tree") {
			const index = buildTreeArchiveIndex(allEntries, activeEntries);
			const projected = (index.archives.length === 0 || index.invalidManifest) && boundaryIndex >= 0
				? messages.slice(boundaryIndex)
				: messages;
			this.rolloverPending = false;
			return filterTreeArchiveSummaries(projected, index);
		}
		if (boundaryIndex < 0) return [...messages];
		this.rolloverPending = false;
		return messages.slice(boundaryIndex);
	}

	async startNewWindow(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		options: StartContextWindowOptions,
	): Promise<boolean> {
		if (this.rolloverPending) return false;
		this.rolloverPending = true;
		try {
			const current = this.identity;
			const threadHint = current && options.mode
				? await this.loadThreadHint(ctx, options.mode, options.signal)
				: undefined;
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
			this.sendWindowMessage(pi, next, options, threadHint);
			return true;
		} catch (error) {
			this.rolloverPending = false;
			throw error;
		}
	}

	recordBudget(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		active: boolean,
		contextTokens?: number,
	): void {
		if (!active || !this.identity) return;
		const reminder = this.budget.record(ctx, this.identity, contextTokens);
		if (reminder) sendContextWindowMessage(
			pi, reminder.content, reminder.kind, this.identity,
			{ triggerTurn: reminder.kind === "fallback" },
		);
	}

	remaining(ctx: ExtensionContext, contextTokens?: number): ContextRemaining {
		return this.budget.remaining(ctx, this.identity, contextTokens);
	}

	prepareCompaction(
		event: SessionBeforeCompactEvent,
		mode: ContextManagementMode,
	):
		| { cancel: true }
		| { compaction: CompactionResult<ContextWindowCompactionDetails> }
		| undefined {
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
		if (mode === "tree" && event.reason === "manual") return undefined;
		return { compaction: this.createCompaction(event) };
	}

	recordCompaction(details: unknown): void {
		if (
			isContextWindowCompactionDetails(details) &&
			details.windowId === this.trimPendingWindowId
		)
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
		identity: ContextWindowIdentity,
		options: StartContextWindowOptions,
		threadHint?: string,
	): void {
		this.identity = identity;
		this.trimPendingWindowId = options.trimPreviousWindow
			? identity.currentWindowId
			: undefined;
		sendContextWindowMessage(
			pi,
			renderContextWindowMessage(identity, threadHint),
			"window",
			identity,
			options,
			options.trimPreviousWindow,
		);
	}

}

function identityFromDetails(
	details: CodexContextManagementMessageDetails,
): ContextWindowIdentity {
	const context = details.contextManagement;
	return {
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
