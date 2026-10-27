import { randomUUID } from "node:crypto";
import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	CustomMessageEntryDraft,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { NotesLifecycle } from "./lifecycle.js";

interface Checkpoint {
	sessionId: string;
	windowId: string;
	requestId: string;
	runId: string | undefined;
	outcome: "completed" | "aborted" | "error" | undefined;
}

// Owns checkpoint request/run association and completed-write eligibility.
export class FreshCheckpoint {
	private checkpoint: Checkpoint | undefined;
	private readonly host: Pick<NotesLifecycle, "windows" | "fresh">;
	private readonly sendMessage: (
		message: Omit<CustomMessageEntryDraft, "type">,
		options: { triggerTurn: boolean },
	) => void;
	constructor(
		host: FreshCheckpoint["host"],
		sendMessage: FreshCheckpoint["sendMessage"],
	) {
		this.host = host;
		this.sendMessage = sendMessage;
	}
	get pending(): boolean {
		return Boolean(this.checkpoint);
	}
	reset(): void {
		this.checkpoint = undefined;
	}
	take(): Checkpoint | undefined {
		const checkpoint = this.checkpoint;
		this.checkpoint = undefined;
		return checkpoint;
	}
	bind(event: BeforeAgentStartEvent, runId: string): void {
		if (
			this.checkpoint &&
			event.messageType === "custom" &&
			event.message.customType === "notes-compaction:checkpoint:v1" &&
			(event.message.details as { requestId?: string } | undefined)
				?.requestId === this.checkpoint.requestId
		)
			this.checkpoint.runId = runId;
	}

	outcome(outcome: "completed" | "aborted" | "error"): void {
		if (this.checkpoint) this.checkpoint.outcome = outcome;
	}
	start(ctx: ExtensionContext, instructions?: string): void {
		if (!ctx.isIdle() || !this.host.windows.current || this.checkpoint)
			throw new Error("A checkpoint cannot start until the session settles");
		const requestId = randomUUID();
		this.checkpoint = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.host.windows.current.currentWindowId,
			requestId,
			runId: undefined,
			outcome: undefined,
		};
		try {
			this.sendMessage(
				{
					customType: "notes-compaction:checkpoint:v1",
					details: { requestId },
					content: `<context_window_reminder>\nSave the task state in notes, then finish your reply. A new window opens automatically after your reply; do not call new_context. If saving fails, report the error.\n</context_window_reminder>${instructions?.trim() ? `\n\nCheckpoint guidance:\n${instructions}` : ""}`,
					display: true,
				},
				{ triggerTurn: true },
			);
		} catch (error) {
			this.checkpoint = undefined;
			throw error;
		}
	}

	permitsRollover(
		checkpoint: Checkpoint,
		event: AgentSettledEvent,
		ctx: ExtensionContext,
	): boolean {
		const valid =
			checkpoint.sessionId === ctx.sessionManager.getSessionId() &&
			checkpoint.windowId === this.host.windows.current?.currentWindowId;
		const aborted =
			event.aborted ||
			checkpoint.outcome === "aborted" ||
			checkpoint.outcome === undefined;
		if (!valid || aborted) {
			ctx.ui.notify(
				"Checkpoint cancelled. The old context remains.",
				"warning",
			);
			return false;
		}
		if (
			checkpoint.outcome !== "completed" ||
			!checkpoint.runId ||
			!this.host.fresh(ctx, checkpoint.runId)
		) {
			ctx.ui.notify(
				"Rollover did not start. No fresh note was saved in the completed checkpoint. The old context remains.",
				"warning",
			);
			return false;
		}
		return true;
	}
}
