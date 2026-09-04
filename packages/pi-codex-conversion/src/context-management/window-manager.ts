import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ProviderHeaders } from "@earendil-works/pi-ai";
import type {
	CompactionResult,
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import { fetchHistoryNotesThreadHint } from "./history-notes.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_STRATEGY,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
	CONTEXT_WINDOW_FALLBACK_BUFFER,
	CONTEXT_WINDOW_FALLBACK_MESSAGE,
	CONTEXT_WINDOW_REMINDER_THRESHOLD,
	type CodexContextManagementMessageDetails,
	type ContextManagementMessageKind,
	type ContextWindowCompactionDetails,
	type ContextWindowIdentity,
	isCodexContextManagementMessageDetails,
	isContextWindowBoundary,
	isContextWindowCompactionDetails,
	renderContextWindowMessage,
	renderContextWindowReminder,
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

interface ContextRemaining {
	remainingTokens: number | undefined;
	windowId: string | undefined;
	contextWindow: number;
}

type ThreadHintLoader = (
	ctx: ExtensionContext,
	mode: ContextManagementMode,
	signal?: AbortSignal,
) => Promise<string | undefined>;

export class CodexContextWindowManager {
	private identity: ContextWindowIdentity | undefined;
	private readonly remindedWindows = new Set<string>();
	private readonly exhaustedWindows = new Set<string>();
	private rolloverPending = false;
	private trimPendingWindowId: string | undefined;
	private readonly loadThreadHint: ThreadHintLoader;

	constructor(loadThreadHint: ThreadHintLoader = fetchHistoryNotesThreadHint) {
		this.loadThreadHint = loadThreadHint;
	}

	reset(): void {
		this.identity = undefined;
		this.remindedWindows.clear();
		this.exhaustedWindows.clear();
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
			if (details.kind === "reminder")
				this.remindedWindows.add(details.currentWindowId);
			if (details.kind === "fallback")
				this.exhaustedWindows.add(details.currentWindowId);
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
			const threadHint = current && options.mode === "remote"
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
		const remaining = this.remaining(ctx, contextTokens);
		if (remaining.remainingTokens === undefined) return;
		const windowId = this.identity.currentWindowId;
		if (
			remaining.remainingTokens <= 0 &&
			!this.exhaustedWindows.has(windowId)
		) {
			this.exhaustedWindows.add(windowId);
			this.sendContextMessage(
				pi,
				CONTEXT_WINDOW_FALLBACK_MESSAGE,
				"fallback",
				this.identity,
				{ triggerTurn: true },
			);
			return;
		}
		if (
			remaining.remainingTokens <= CONTEXT_WINDOW_REMINDER_THRESHOLD &&
			!this.remindedWindows.has(windowId)
		) {
			this.remindedWindows.add(windowId);
			this.sendContextMessage(
				pi,
				renderContextWindowReminder(remaining.remainingTokens),
				"reminder",
				this.identity,
				{ triggerTurn: false },
			);
		}
	}

	remaining(
		ctx: ExtensionContext,
		contextTokens?: number,
	): ContextRemaining {
		const usage = ctx.getContextUsage();
		if (!usage && contextTokens === undefined)
			return {
				remainingTokens: undefined,
				windowId: this.identity?.currentWindowId,
				contextWindow: Math.max(
					0,
					(ctx.model?.contextWindow ?? 0) - CONTEXT_WINDOW_FALLBACK_BUFFER,
				),
			};
		const contextWindow = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
		const limit = Math.max(
			0,
			contextWindow - CONTEXT_WINDOW_FALLBACK_BUFFER,
		);
		return {
			remainingTokens:
				contextTokens !== undefined
					? Math.max(0, limit - contextTokens)
					: usage?.tokens === null || usage?.tokens === undefined
					? undefined
					: Math.max(0, limit - usage.tokens),
			windowId: this.identity?.currentWindowId,
			contextWindow: limit,
		};
	}

	prepareCompaction(
		event: SessionBeforeCompactEvent,
		mode: ContextManagementMode,
	):
		| { cancel: true }
		| { compaction: CompactionResult<ContextWindowCompactionDetails> }
		| undefined {
		if (event.reason === "threshold") {
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
		if (!this.identity || !isRecord(payload)) return payload;
		const metadata = this.requestMetadata(ctx);
		const clientMetadata = isRecord(payload["client_metadata"])
			? payload["client_metadata"]
			: {};
		return {
			...payload,
			client_metadata: {
				...clientMetadata,
				"x-codex-window-id": metadata.window_id,
				"x-codex-turn-metadata": JSON.stringify(metadata),
			},
		};
	}

	rewriteHeaders(headers: ProviderHeaders, ctx: ExtensionContext): void {
		if (!this.identity) return;
		const metadata = this.requestMetadata(ctx);
		headers["x-codex-window-id"] = metadata.window_id;
		headers["x-codex-turn-metadata"] = JSON.stringify(metadata);
	}

	private requestMetadata(ctx: ExtensionContext): {
		session_id: string;
		thread_id: string;
		agent_name: string;
		window_id: string;
		window_number: number;
		context_window_id: string;
		request_kind: "turn";
		history_ingest_requested: true;
	} {
		const sessionId = ctx.sessionManager.getSessionId();
		const identity = this.identity!;
		return {
			session_id: sessionId,
			thread_id: sessionId,
			agent_name: "/root",
			window_id: `${sessionId}:${identity.windowNumber}`,
			window_number: identity.windowNumber,
			context_window_id: identity.currentWindowId,
			request_kind: "turn",
			history_ingest_requested: true,
		};
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
		this.sendContextMessage(
			pi,
			renderContextWindowMessage(identity, threadHint),
			"window",
			identity,
			options,
			options.trimPreviousWindow,
		);
	}

	private sendContextMessage(
		pi: ExtensionAPI,
		content: string,
		kind: ContextManagementMessageKind,
		identity: ContextWindowIdentity,
		options: { triggerTurn: boolean },
		trimPreviousWindow = false,
	): void {
		pi.sendMessage<CodexContextManagementMessageDetails>(
			{
				customType: CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
				content,
				display: true,
				details: {
					protocol: 1,
					id: randomUUID(),
					contextManagement: {
						protocol: 1,
						kind,
						...identity,
						...(trimPreviousWindow
							? { trimPreviousWindow: true as const }
							: {}),
					},
				},
			},
			options.triggerTurn
				? { deliverAs: "steer", triggerTurn: true }
				: { triggerTurn: false },
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
