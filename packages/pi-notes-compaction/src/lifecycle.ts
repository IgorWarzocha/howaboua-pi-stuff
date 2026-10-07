import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	SessionBeforeCompactEvent,
	SessionCompactFailedEvent,
} from "@earendil-works/pi-coding-agent";
import type { NotesBridge } from "./bridge.js";
import { hasFreshNotes } from "./fresh-notes.js";
import { noteHints, sessionRef } from "./notes.js";
import type { NotesStore } from "./store.js";
import {
	SETTLEMENT_ENTRY,
	WINDOW_MESSAGE,
	Windows,
	windowDetails,
	windowMessage,
} from "./windows.js";

interface Checkpoint {
	sessionId: string;
	windowId: string;
	prompt: string;
	admitted: boolean;
	runId: string | undefined;
	outcome: "completed" | "aborted" | "error" | undefined;
	aborted: boolean;
	stopObserving: (() => void) | undefined;
}
interface HeldInput {
	sessionId: string;
	phase: "failed" | "rolling" | "releasing" | "draining";
	releasePrompt: string;
	admissions: ((result: InputEventResult) => void)[];
}
interface Rollover {
	sessionId: string;
	phase: "scheduled" | "compacting";
	triggerTurn: boolean;
}

export class NotesLifecycle {
	readonly windows = new Windows();
	active = false;
	normalCompaction = false;
	bridge: NotesBridge | undefined;
	runId = "";
	private checkpoint: Checkpoint | undefined;
	private held: HeldInput | undefined;
	private rollover: Rollover | undefined;
	private cancelledCompact:
		| {
				sessionId: string;
				signal: AbortSignal;
				instructions: string | undefined;
		  }
		| undefined;

	private readonly pi: ExtensionAPI;
	private readonly store: NotesStore;
	constructor(pi: ExtensionAPI, store: NotesStore) {
		this.pi = pi;
		this.store = store;
	}
	agent(ctx: ExtensionContext): string {
		return this.bridge?.agentName?.(ctx) ?? "/root";
	}
	reset(ctx?: ExtensionContext): void {
		this.checkpoint?.stopObserving?.();
		this.checkpoint = undefined;
		this.rollover = undefined;
		this.cancelledCompact = undefined;
		for (const admit of this.held?.admissions ?? [])
			admit({ action: "handled" });
		this.held = undefined;
		this.runId = "";
		this.windows.restore(ctx?.sessionManager.getBranch() ?? []);
	}
	initialize(ctx: ExtensionContext): void {
		const branch = ctx.sessionManager.getBranch();
		this.windows.restore(branch);
		const latest = branch.findLast(
			(entry) =>
				entry.type === "custom_message" &&
				entry.customType === WINDOW_MESSAGE &&
				["window", "identity"].includes(windowDetails(entry)?.kind ?? ""),
		);
		if (!this.windows.current || !latest) {
			const inherited = Boolean(this.windows.current);
			const ids = this.windows.current ?? this.windows.next();
			this.pi.sendMessage(
				windowMessage(
					ids,
					this.agent(ctx),
					noteHints(this.store, ctx, this.agent(ctx)),
					false,
					inherited ? "identity" : "window",
				),
				{ triggerTurn: false },
			);
			this.windows.current = ids;
		} else if (
			latest.type === "custom_message" &&
			typeof latest.content === "string" &&
			!latest.content.includes(`Agent name: ${this.agent(ctx)}\n`)
		) {
			this.pi.sendMessage(
				windowMessage(
					this.windows.current,
					this.agent(ctx),
					noteHints(this.store, ctx, this.agent(ctx)),
					false,
					"identity",
				),
				{ triggerTurn: false },
			);
		}
	}
	beforeStart(ctx: ExtensionContext): void {
		this.initialize(ctx);
		this.runId = randomUUID();
		if (this.checkpoint?.admitted) this.checkpoint.runId = this.runId;
	}
	observeRun(ctx: ExtensionContext): void {
		const checkpoint = this.checkpoint;
		if (!checkpoint || !ctx.signal) return;
		const signal = ctx.signal;
		const abort = () => {
			checkpoint.aborted = true;
		};
		if (signal.aborted) abort();
		else signal.addEventListener("abort", abort, { once: true });
		checkpoint.stopObserving = () => signal.removeEventListener("abort", abort);
	}
	outcome(outcome: "completed" | "aborted" | "error"): void {
		if (this.checkpoint) this.checkpoint.outcome = outcome;
	}
	fresh(ctx: ExtensionContext, runId?: string): boolean {
		return hasFreshNotes(
			ctx.sessionManager.getBranch(),
			this.windows.current?.currentWindowId,
			runId,
		);
	}
	requestRollover(ctx: ExtensionContext): boolean {
		if (this.checkpoint || this.held) return false;
		if (this.rollover) return false;
		this.rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			phase: "scheduled",
			triggerTurn: true,
		};
		return true;
	}
	private async openWindow(
		ctx: ExtensionContext,
		triggerTurn: boolean,
		trim: boolean,
	): Promise<void> {
		if (!ctx.isIdle())
			throw new Error("Wait for the current run to settle before rollover");
		const sessionId = ctx.sessionManager.getSessionId();
		await this.bridge?.beforeWindow?.(ctx);
		if (sessionId !== ctx.sessionManager.getSessionId() || !this.active)
			throw new Error("Session changed before rollover");
		const ids = this.windows.next();
		const hint = noteHints(this.store, ctx, this.agent(ctx));
		this.pi.sendMessage(windowMessage(ids, this.agent(ctx), hint, trim), {
			triggerTurn: false,
		});
		this.windows.current = ids;
		if (triggerTurn) this.pi.sendUserMessage("Continue.");
	}
	private async roll(
		ctx: ExtensionContext,
		triggerTurn: boolean,
	): Promise<void> {
		if (!this.normalCompaction) {
			await this.openWindow(ctx, triggerTurn, true);
			return;
		}
		const pending: Rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			phase: "compacting",
			triggerTurn,
		};
		this.rollover = pending;
		await new Promise<void>((resolve, reject) => {
			ctx.compact({
				onComplete: () => {
					if (
						this.rollover !== pending ||
						pending.sessionId !== ctx.sessionManager.getSessionId()
					) {
						reject(new Error("Session changed during compaction"));
						return;
					}
					this.rollover = undefined;
					void this.openWindow(ctx, triggerTurn, false).then(resolve, reject);
				},
				onError: (error) => {
					if (this.rollover === pending) this.rollover = undefined;
					reject(error);
				},
			});
		});
	}
	private startCheckpoint(ctx: ExtensionContext, instructions?: string): void {
		if (!ctx.isIdle() || !this.windows.current || this.checkpoint)
			throw new Error("A checkpoint cannot start until the session settles");
		const prompt = `Save the requested context checkpoint. Checkpoint request: ${randomUUID()}`;
		this.checkpoint = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.windows.current.currentWindowId,
			prompt,
			admitted: false,
			runId: undefined,
			outcome: undefined,
			aborted: false,
			stopObserving: undefined,
		};
		try {
			this.pi.sendMessage(
				{
					customType: "notes-compaction:checkpoint:v1",
					content: `<context_window_reminder>\nContext checkpoint requested. Save the current state with notes, then finish your response. The new window opens after this run settles. Do not call new_context. If saving fails, report the failure without rolling over.\n</context_window_reminder>${instructions?.trim() ? `\n\nCheckpoint guidance:\n${instructions}` : ""}`,
					display: true,
				},
				{ triggerTurn: false },
			);
			// A settled user kickoff runs ALL input and before_agent_start handlers.
			this.pi.sendUserMessage(prompt);
		} catch (error) {
			this.checkpoint = undefined;
			throw error;
		}
	}
	private idleDue(ctx: ExtensionContext): boolean {
		if (
			!ctx.isIdle() ||
			!this.windows.current ||
			this.rollover ||
			this.checkpoint
		)
			return false;
		const branch = ctx.sessionManager.getBranch();
		const terminal = branch.findLast(
			(entry) => entry.type === "message" && entry.message.role !== "system",
		);
		if (!terminal) return false;
		const settlement = ctx.sessionManager
			.getEntries()
			.findLast(
				(entry) =>
					entry.type === "custom" &&
					entry.customType === SETTLEMENT_ENTRY &&
					entry.data &&
					typeof entry.data === "object" &&
					"completedEntryId" in entry.data &&
					entry.data.completedEntryId === terminal.id,
			);
		if (
			settlement?.type !== "custom" ||
			!settlement.data ||
			typeof settlement.data !== "object"
		)
			return false;
		const data = settlement.data;
		return (
			"windowId" in data &&
			data.windowId === this.windows.current.currentWindowId &&
			"settledAt" in data &&
			typeof data.settledAt === "number" &&
			Number.isFinite(data.settledAt) &&
			Date.now() - data.settledAt >= 25 * 60_000
		);
	}
	async input(
		event: InputEvent,
		ctx: ExtensionContext,
	): Promise<InputEventResult | undefined> {
		const releasing = this.held;
		if (
			releasing?.phase === "releasing" &&
			event.source === "extension" &&
			event.text === releasing.releasePrompt
		) {
			const admit = releasing.admissions.shift();
			if (releasing.admissions.length) releasing.phase = "draining";
			else this.held = undefined;
			admit?.({ action: "continue" });
			return { action: "handled" };
		}
		const checkpoint = this.checkpoint;
		if (
			checkpoint &&
			!checkpoint.admitted &&
			event.source === "extension" &&
			event.text === checkpoint.prompt
		) {
			checkpoint.admitted = true;
			return;
		}
		if (!this.held && (!this.idleDue(ctx) || !this.fresh(ctx))) return;
		const held =
			this.held ??
			({
				sessionId: ctx.sessionManager.getSessionId(),
				phase: "failed",
				releasePrompt: `Admit saved input: ${randomUUID()}`,
				admissions: [],
			} satisfies HeldInput);
		this.held = held;
		const admission = new Promise<InputEventResult>((resolve) =>
			held.admissions.push(resolve),
		);
		if (held.phase !== "failed") return admission;
		held.phase = "rolling";
		void Promise.resolve().then(async () => {
			try {
				if (
					this.held !== held ||
					held.sessionId !== ctx.sessionManager.getSessionId()
				)
					return;
				await this.finishHeld(ctx, held);
			} catch (error) {
				this.failHeld(ctx, held, error);
			}
		});
		return admission;
	}
	private failHeld(
		ctx: ExtensionContext,
		held: HeldInput,
		error: unknown,
	): void {
		if (this.held !== held) return;
		held.phase = "failed";
		ctx.ui.notify(
			`Idle rollover failed: ${error instanceof Error ? error.message : String(error)}. Input and attachments remain pending. Submit another prompt to retry, or reload to cancel.`,
			"error",
		);
	}
	private async finishHeld(
		ctx: ExtensionContext,
		held: HeldInput,
	): Promise<void> {
		held.phase = "rolling";
		await this.roll(ctx, false);
		if (
			this.held !== held ||
			held.sessionId !== ctx.sessionManager.getSessionId()
		)
			return;
		held.phase = "releasing";
		// Pi defers this user kickoff until EVERY agent_settled handler returns.
		// Its input-only admission releases the original SDK calls, preserving images/options.
		this.pi.sendUserMessage(held.releasePrompt);
	}
	beforeCompact(
		event: SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	): { cancel: true } | undefined {
		if (
			this.normalCompaction ||
			this.rollover?.phase === "compacting" ||
			event.reason === "overflow"
		)
			return;
		if (event.reason === "manual")
			this.cancelledCompact = {
				sessionId: ctx.sessionManager.getSessionId(),
				signal: event.signal,
				instructions: event.customInstructions,
			};
		return { cancel: true };
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
		if (!pending.instructions?.trim() && this.fresh(ctx))
			await this.roll(ctx, true);
		else this.startCheckpoint(ctx, pending.instructions);
	}
	async settled(ctx: ExtensionContext): Promise<void> {
		const checkpoint = this.checkpoint;
		this.checkpoint = undefined;
		checkpoint?.stopObserving?.();
		try {
			this.store.updateFile(sessionRef(ctx));
			const terminal = ctx.sessionManager
				.getBranch()
				.findLast(
					(entry) =>
						entry.type === "message" && entry.message.role !== "system",
				);
			if (terminal && this.windows.current)
				this.pi.appendEntry(SETTLEMENT_ENTRY, {
					protocol: 1,
					windowId: this.windows.current.currentWindowId,
					completedEntryId: terminal.id,
					settledAt: Date.now(),
				});
		} catch (error) {
			this.rollover = undefined;
			if (
				checkpoint &&
				(checkpoint.aborted ||
					checkpoint.outcome === "aborted" ||
					checkpoint.outcome === undefined)
			) {
				ctx.ui.notify(
					"Checkpoint cancelled. The old context remains.",
					"warning",
				);
			} else if (this.held) this.failHeld(ctx, this.held, error);
			else throw error;
			return;
		}
		if (checkpoint) {
			const valid =
				checkpoint.sessionId === ctx.sessionManager.getSessionId() &&
				checkpoint.windowId === this.windows.current?.currentWindowId;
			const aborted =
				checkpoint.aborted ||
				checkpoint.outcome === "aborted" ||
				checkpoint.outcome === undefined;
			if (!valid || aborted) {
				ctx.ui.notify(
					"Checkpoint cancelled. The old context remains.",
					"warning",
				);
				return;
			}
			if (
				checkpoint.outcome !== "completed" ||
				!checkpoint.runId ||
				!this.fresh(ctx, checkpoint.runId)
			) {
				ctx.ui.notify(
					"Rollover did not start. No fresh note was saved in the completed checkpoint. The old context remains.",
					"warning",
				);
				return;
			}
			await this.roll(ctx, true);
			return;
		}
		if (this.held?.phase === "draining") {
			// Retry admissions are original SDK calls too. Releasing all at once races Agent.prompt.
			this.held.phase = "releasing";
			this.pi.sendUserMessage(this.held.releasePrompt);
			return;
		}
		const rollover = this.rollover;
		if (
			rollover?.phase === "scheduled" &&
			rollover.sessionId === ctx.sessionManager.getSessionId()
		) {
			this.rollover = undefined;
			await this.roll(ctx, rollover.triggerTurn);
		}
	}
}
