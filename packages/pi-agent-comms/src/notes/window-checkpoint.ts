import {
	buildSessionProjection,
	type CompactionEntryDraft,
	calculateContextTokens,
	type ExtensionContext,
	estimateTokens,
	getLastAssistantUsage,
	type SessionBeforeCompactEvent,
	type SessionBeforeCompactResult,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { windowDetails } from "./window-message.js";

const MARKER = "pi-notes-compaction/window-checkpoint";

export function isWindowCheckpoint(entry: SessionEntry): boolean {
	return (
		entry.type === "compaction" &&
		entry.details !== null &&
		typeof entry.details === "object" &&
		MARKER in entry.details &&
		entry.details[MARKER] === 1
	);
}

export function windowCheckpointDraft(
	firstKeptEntryId: string,
): CompactionEntryDraft {
	return {
		type: "compaction",
		summary: "",
		firstKeptEntryId,
		details: { [MARKER]: 1 },
	};
}

/** Persist one complete native cut, never a partially edited conversation. */
export class WindowCheckpoints {
	private pending: { session: string; firstKeptEntryId: string } | undefined;
	private readonly project: (
		entries: readonly SessionEntry[],
	) => SessionEntry[];

	constructor(project: (entries: readonly SessionEntry[]) => SessionEntry[]) {
		this.project = project;
	}

	draft(entries: readonly SessionEntry[]): CompactionEntryDraft | undefined {
		const kept = this.project(entries);
		const first = kept[0];
		if (!first || first.id === entries[0]?.id) return;
		const details = kept
			.map(windowDetails)
			.findLast((details) => details?.kind === "window" && details.trim);
		// Prefix-window guides precede the owned carrier in the logical replay,
		// but the native checkpoint must keep the physical kickoff, not old history.
		const firstKeptEntryId =
			details?.prefixGuidance && details.tail
				? details.tail.firstKeptEntryId
				: first.id;
		const previous = entries.findLast((entry) => entry.type === "compaction");
		if (previous?.firstKeptEntryId === firstKeptEntryId) return;
		return windowCheckpointDraft(firstKeptEntryId);
	}

	prepare(
		event: SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	): SessionBeforeCompactResult | undefined {
		if (!this.pending) return;
		const draft = this.draft(event.branchEntries);
		if (
			event.reason !== "manual" ||
			ctx.sessionManager.getSessionId() !== this.pending.session ||
			draft?.firstKeptEntryId !== this.pending.firstKeptEntryId
		)
			return { cancel: true };
		const kept = this.project(event.branchEntries);
		const messages = buildSessionProjection(kept).messages;
		const usage = getLastAssistantUsage(kept);
		return {
			compaction: {
				summary: draft.summary,
				firstKeptEntryId: this.pending.firstKeptEntryId,
				tokensBefore: usage
					? calculateContextTokens(usage)
					: messages.reduce(
							(tokens, message) => tokens + estimateTokens(message),
							0,
						),
				details: draft.details,
			},
		};
	}

	/** Align restored sessions before Pi's first request-time structuredClone. */
	async restore(ctx: ExtensionContext): Promise<void> {
		const draft = this.draft(ctx.sessionManager.getBranch());
		if (!draft?.firstKeptEntryId || !ctx.model) return;
		this.pending = {
			session: ctx.sessionManager.getSessionId(),
			firstKeptEntryId: draft.firstKeptEntryId,
		};
		try {
			await new Promise<void>((resolve, reject) => {
				ctx.compact({
					onComplete: () => resolve(),
					onError: (error) => {
						// Pi cannot cut a small conversation yet. The next completed
						// turn can persist the same complete cut as a boundary draft.
						if (error.message === "Nothing to compact (session too small)")
							resolve();
						else reject(error);
					},
				});
			});
		} finally {
			this.pending = undefined;
		}
	}
}
