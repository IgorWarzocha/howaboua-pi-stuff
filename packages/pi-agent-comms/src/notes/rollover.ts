import type {
	CustomMessageEntryDraft,
	ExtensionContext,
	SessionBeforeCompactEvent,
	SessionCompactFailedEvent,
} from "@earendil-works/pi-coding-agent";
import { prepareCompactionProjection } from "./compaction-projection.js";
import type { NotesLifecycle } from "./lifecycle.js";
import type { ModelRoleHandoff } from "./model-roles.js";

type Rollover = {
	sessionId: string;
	windowId: string | undefined;
	triggerTurn: boolean;
	handoff?: ModelRoleHandoff;
} & (
	| { phase: "scheduled" | "compacting" }
	| { phase: "checking"; accepted?: AbortSignal }
);

// Owns scheduled rollover, compaction callback identity and manual cancellation receipts.
export class RolloverRequests {
	private rollover: Rollover | undefined;
	private cancelledCompact:
		| {
				sessionId: string;
				signal: AbortSignal;
				instructions: string | undefined;
		  }
		| undefined;
	private readonly host: Pick<
		NotesLifecycle,
		"active" | "windows" | "normalCompaction" | "newWindowRequests" | "fresh"
	>;
	private readonly openWindow: (
		ctx: ExtensionContext,
		triggerTurn: boolean,
		trim: boolean,
		handoff?: ModelRoleHandoff,
	) => Promise<void>;
	private readonly sendMessage: (
		message: Omit<CustomMessageEntryDraft, "type">,
		options: { triggerTurn: boolean },
	) => void;
	private readonly startCheckpoint: (
		ctx: ExtensionContext,
		instructions?: string,
	) => void;
	constructor(
		host: RolloverRequests["host"],
		openWindow: RolloverRequests["openWindow"],
		sendMessage: RolloverRequests["sendMessage"],
		startCheckpoint: RolloverRequests["startCheckpoint"],
	) {
		this.host = host;
		this.openWindow = openWindow;
		this.sendMessage = sendMessage;
		this.startCheckpoint = startCheckpoint;
	}
	get pending(): boolean {
		return Boolean(this.rollover);
	}
	reset(): void {
		this.rollover = undefined;
		this.cancelledCompact = undefined;
	}
	clear(): void {
		this.rollover = undefined;
	}
	schedule(ctx: ExtensionContext, handoff?: ModelRoleHandoff): void {
		this.rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.host.windows.current?.currentWindowId,
			phase: "scheduled",
			triggerTurn: true,
			...(handoff ? { handoff } : {}),
		};
	}
	settled(ctx: ExtensionContext): Promise<void> | undefined {
		const rollover = this.rollover;
		if (
			rollover?.phase === "scheduled" &&
			rollover.sessionId === ctx.sessionManager.getSessionId() &&
			rollover.windowId === this.host.windows.current?.currentWindowId
		) {
			this.rollover = undefined;
			return this.roll(ctx, rollover.triggerTurn, rollover.handoff);
		}
	}

	async roll(
		ctx: ExtensionContext,
		triggerTurn: boolean,
		handoff?: ModelRoleHandoff,
	): Promise<void> {
		const policy = triggerTurn ? this.host.newWindowRequests : undefined;
		const checkOnly = !this.host.normalCompaction && policy === "pi-limits";
		if (!this.host.normalCompaction && !checkOnly) {
			await this.openWindow(ctx, triggerTurn, true, handoff);
			return;
		}
		const pending: Rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.host.windows.current?.currentWindowId,
			phase: checkOnly ? "checking" : "compacting",
			triggerTurn,
			...(handoff ? { handoff } : {}),
		};
		this.rollover = pending;
		await new Promise<void>((resolve, reject) => {
			const current = () =>
				this.host.active &&
				this.rollover === pending &&
				pending.sessionId === ctx.sessionManager.getSessionId() &&
				pending.windowId === this.host.windows.current?.currentWindowId;
			const finish = (trim: boolean) => {
				this.rollover = undefined;
				void this.openWindow(ctx, triggerTurn, trim, handoff).then(
					resolve,
					reject,
				);
			};
			ctx.compact({
				onComplete: () => {
					if (!current()) {
						reject(new Error("Session changed during compaction"));
						return;
					}
					finish(false);
				},
				onError: (error) => {
					if (current()) {
						// Only our own accepted gate cancels a summary in favour of notes-only rollover.
						if (
							pending.phase === "checking" &&
							pending.accepted &&
							!pending.accepted.aborted &&
							error.message === "Compaction cancelled"
						) {
							finish(true);
							return;
						}
						if (
							error.message === "Nothing to compact (session too small)" ||
							error.message === "Already compacted"
						) {
							if (policy === "unrestricted") {
								// A new identity need not retire history when Pi has no summary work.
								finish(false);
								return;
							}
							this.rollover = undefined;
							try {
								if (triggerTurn)
									this.sendMessage(
										{
											customType: "notes-compaction:continuation",
											content:
												"Not enough history to compact. Continue here; wait for more conversation before calling new_context again.",
											display: true,
										},
										{ triggerTurn: true },
									);
								resolve();
							} catch (error) {
								reject(error);
							}
							return;
						}
					}
					if (this.rollover === pending) this.rollover = undefined;
					reject(error);
				},
			});
		});
	}
	beforeCompact(
		event: SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	): { cancel: true } | undefined {
		if (this.rollover?.phase === "checking" && event.reason === "manual") {
			this.rollover.accepted = event.signal;
			return { cancel: true };
		}
		if (this.allowsCompaction(event.reason)) {
			return prepareCompactionProjection(event, ctx, this.host.windows);
		}
		if (event.reason === "manual")
			this.cancelledCompact = {
				sessionId: ctx.sessionManager.getSessionId(),
				signal: event.signal,
				instructions: event.customInstructions,
			};
		return { cancel: true };
	}
	allowsCompaction(reason: SessionBeforeCompactEvent["reason"]): boolean {
		if (this.rollover?.phase === "checking" && reason === "manual")
			return false;
		return (
			!this.host.active ||
			this.host.normalCompaction ||
			this.rollover?.phase === "compacting" ||
			reason === "overflow"
		);
	}
	async compactFailed(
		event: SessionCompactFailedEvent,
		ctx: ExtensionContext,
	): Promise<void> {
		const pending = this.cancelledCompact;
		this.cancelledCompact = undefined;
		if (
			!pending ||
			event.reason !== "manual" ||
			!event.aborted ||
			pending.signal.aborted ||
			pending.sessionId !== ctx.sessionManager.getSessionId()
		)
			return;
		if (!pending.instructions?.trim() && this.host.fresh(ctx))
			await this.roll(ctx, false);
		else this.startCheckpoint(ctx, pending.instructions);
	}
}
