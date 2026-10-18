import { randomUUID } from "node:crypto";
import type {
	AgentSettledEvent,
	BeforeAgentStartEvent,
	BeforeAgentStartEventResult,
	CustomMessageEntryDraft,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
	SessionBeforeCompactEvent,
	SessionCompactFailedEvent,
} from "@earendil-works/pi-coding-agent";
import {
	buildSessionProjection,
	prepareBranchEntries,
} from "@earendil-works/pi-coding-agent";
import type { NotesBridge } from "./bridge.js";
import {
	hasFreshNotes,
	hasPrecedingNoteWrite,
	NOTES_RUN_ENTRY,
} from "./fresh-notes.js";
import { noteHints, sessionRef } from "./notes.js";
import type { IdleMinutes, NewWindowRequests } from "./settings.js";
import { savedNotesIdentity } from "./shared-notes.js";
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
	requestId: string;
	runId: string | undefined;
	outcome: "completed" | "aborted" | "error" | undefined;
}
interface HeldInput {
	sessionId: string;
	phase: "failed" | "rolling" | "releasing" | "draining";
	releasePrompt: string;
	admissions: ((result: InputEventResult) => void)[];
}
type Rollover = {
	sessionId: string;
	windowId: string | undefined;
	triggerTurn: boolean;
} & (
	| { phase: "scheduled" | "compacting" }
	| { phase: "checking"; accepted?: AbortSignal }
);

export class NotesLifecycle {
	readonly windows = new Windows();
	gptPromptMode = () => false;
	active = false;
	normalCompaction = false;
	newWindowRequests: NewWindowRequests = "unrestricted";
	idleMinutes: IdleMinutes = 0;
	taskBoundaryReminder = 0;
	bridge: NotesBridge | undefined;
	runId = "";
	private checkpoint: Checkpoint | undefined;
	private held: HeldInput | undefined;
	private rollover: Rollover | undefined;
	private customAdmission: Promise<void> | undefined;
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
	private sendMessage(
		message: Omit<CustomMessageEntryDraft, "type">,
		options: { triggerTurn: boolean },
	): void {
		const draft: CustomMessageEntryDraft = {
			type: "custom_message",
			...message,
			details: message.details ?? {},
		};
		this.pi.sendMessage(
			this.bridge?.prepareReminder?.(draft) ?? draft,
			options,
		);
	}
	agent(ctx: ExtensionContext): string {
		return (
			this.bridge?.agentName?.(ctx) ??
			savedNotesIdentity({
				threadId: ctx.sessionManager.getSessionId(),
				entries: ctx.sessionManager.getEntries(),
			}).agentName
		);
	}
	reset(ctx?: ExtensionContext): void {
		this.customAdmission = undefined;
		this.checkpoint = undefined;
		this.rollover = undefined;
		this.cancelledCompact = undefined;
		for (const admit of this.held?.admissions ?? [])
			admit({ action: "handled" });
		this.held = undefined;
		this.runId = "";
		this.windows.restore(ctx?.sessionManager.getBranch() ?? []);
	}
	private initialize(
		ctx: ExtensionContext,
	): CustomMessageEntryDraft | undefined {
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
			this.windows.current = ids;
			return windowMessage(
				ids,
				this.agent(ctx),
				noteHints(this.store, ctx, this.agent(ctx)),
				false,
				inherited ? "identity" : "window",
				this.gptPromptMode(),
			);
		} else if (
			latest.type === "custom_message" &&
			typeof latest.content === "string" &&
			!latest.content.includes(`Agent name: ${this.agent(ctx)}\n`)
		) {
			return windowMessage(
				this.windows.current,
				this.agent(ctx),
				noteHints(this.store, ctx, this.agent(ctx)),
				false,
				"identity",
				this.gptPromptMode(),
			);
		}
	}
	beforeStart(
		ctx: ExtensionContext,
		event: BeforeAgentStartEvent,
	): BeforeAgentStartEventResult | undefined {
		// A custom kickoff is not in the branch until after before_agent_start.
		// Adopt its boundary without restoring the outgoing window or emitting a duplicate.
		const startingWindow =
			event.messageType === "custom"
				? windowDetails({ ...event.message, type: "custom_message" })
				: undefined;
		let message: CustomMessageEntryDraft | undefined;
		if (startingWindow?.kind === "window")
			this.windows.current = startingWindow.identity;
		else message = this.initialize(ctx);
		this.runId = randomUUID();
		this.pi.appendEntry(NOTES_RUN_ENTRY, { runId: this.runId });
		if (
			this.checkpoint &&
			event.messageType === "custom" &&
			event.message.customType === "notes-compaction:checkpoint:v1" &&
			(event.message.details as { requestId?: string } | undefined)
				?.requestId === this.checkpoint.requestId
		)
			this.checkpoint.runId = this.runId;
		return message
			? { message: this.bridge?.prepareReminder?.(message) ?? message }
			: undefined;
	}
	prepareCustomTurn(ctx: ExtensionContext): Promise<void> | undefined {
		if (this.customAdmission) return this.customAdmission;
		if (!this.active || !this.idleDue(ctx) || !this.fresh(ctx)) return;
		const sessionId = ctx.sessionManager.getSessionId();
		const preparation = this.roll(ctx, false)
			.then(() => {
				if (!this.active || sessionId !== ctx.sessionManager.getSessionId())
					throw new Error("Session changed during custom kickoff admission");
			})
			.finally(() => {
				if (this.customAdmission === preparation)
					this.customAdmission = undefined;
			});
		this.customAdmission = preparation;
		return preparation;
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
	requestRollover(ctx: ExtensionContext, callId: string): boolean {
		if (this.newWindowRequests === "off")
			throw new Error(
				"New window requests are disabled. Continue in the current window.",
			);
		if (this.checkpoint || this.held) return false;
		if (this.rollover) return false;
		if (
			!hasPrecedingNoteWrite(
				ctx.sessionManager.getBranch(),
				this.windows.current?.currentWindowId,
				this.runId,
				callId,
			)
		)
			throw new Error(
				"Save your progress with notes, wait for the write to succeed, then call new_context next.",
			);
		this.rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.windows.current?.currentWindowId,
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
		const message = windowMessage(
			ids,
			this.agent(ctx),
			hint,
			trim,
			"window",
			this.gptPromptMode(),
		);
		this.windows.current = ids;
		if (triggerTurn)
			message.content = `${message.content}\n\nRead your saved notes and resume the task.`;
		this.sendMessage(message, { triggerTurn });
	}
	private async roll(
		ctx: ExtensionContext,
		triggerTurn: boolean,
	): Promise<void> {
		const policy = triggerTurn ? this.newWindowRequests : undefined;
		const checkOnly = !this.normalCompaction && policy === "pi-limits";
		if (!this.normalCompaction && !checkOnly) {
			await this.openWindow(ctx, triggerTurn, true);
			return;
		}
		const pending: Rollover = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.windows.current?.currentWindowId,
			phase: checkOnly ? "checking" : "compacting",
			triggerTurn,
		};
		this.rollover = pending;
		await new Promise<void>((resolve, reject) => {
			const current = () =>
				this.active &&
				this.rollover === pending &&
				pending.sessionId === ctx.sessionManager.getSessionId() &&
				pending.windowId === this.windows.current?.currentWindowId;
			const finish = (trim: boolean) => {
				this.rollover = undefined;
				void this.openWindow(ctx, triggerTurn, trim).then(resolve, reject);
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
	private startCheckpoint(ctx: ExtensionContext, instructions?: string): void {
		if (!ctx.isIdle() || !this.windows.current || this.checkpoint)
			throw new Error("A checkpoint cannot start until the session settles");
		const requestId = randomUUID();
		this.checkpoint = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: this.windows.current.currentWindowId,
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
	private idleDue(ctx: ExtensionContext): boolean {
		if (
			this.idleMinutes === 0 ||
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
			!("aborted" in data && data.aborted === true) &&
			"windowId" in data &&
			data.windowId === this.windows.current.currentWindowId &&
			"settledAt" in data &&
			typeof data.settledAt === "number" &&
			Number.isFinite(data.settledAt) &&
			Date.now() - data.settledAt >= this.idleMinutes * 60_000
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
		if (this.rollover?.phase === "checking" && event.reason === "manual") {
			this.rollover.accepted = event.signal;
			return { cancel: true };
		}
		if (this.allowsCompaction(event.reason)) {
			// PCC owns preparation when bridged, including native checkpoint routes.
			if (this.bridge) return;
			try {
				const branch = this.windows.projectBranch(event.branchEntries);
				if (branch.length === event.branchEntries.length) return;
				const physicalCut = event.branchEntries.findIndex(
					(entry) => entry.id === event.preparation.firstKeptEntryId,
				);
				if (physicalCut < 0)
					throw new Error("Compaction kept boundary is missing");
				const keptIds = new Set(
					event.branchEntries.slice(physicalCut).map((entry) => entry.id),
				);
				const projection = buildSessionProjection(branch);
				const projected = projection.entries;
				const summary = projection.messages.find(
					(message) => message.role === "compactionSummary",
				);
				const cut = projected.findIndex((entry) =>
					keptIds.has(entry.sourceEntry.id),
				);
				if (cut < 0)
					throw new Error("Current context kept boundary is missing");
				const summarized = projected.slice(0, cut);
				const messages = summarized
					.flatMap((entry) => entry.messages)
					.filter(
						(message) =>
							message.role !== "system" && message.role !== "compactionSummary",
					);
				if (!messages.length) {
					ctx.ui.notify(
						"Nothing to compact in the current context window. The existing context remains.",
						"warning",
					);
					return { cancel: true };
				}
				// Pi retains this object for its default summarizer after every hook.
				// Keep that route's auth, provider hooks and retries, and physical kept IDs.
				delete event.preparation.previousSummary;
				Object.assign(event.preparation, {
					firstKeptEntryId: projected[cut]!.sourceEntry.id,
					...(summary ? { previousSummary: summary.summary } : {}),
					messagesToSummarize: messages,
					turnPrefixMessages: [],
					isSplitTurn: false,
					fileOps: prepareBranchEntries(
						summarized.flatMap((entry) =>
							entry.messages.map((message) => ({
								...entry.sourceEntry,
								type: "message" as const,
								message,
							})),
						),
					).fileOps,
				});
			} catch (error) {
				ctx.ui.notify(
					`Compaction failed: ${error instanceof Error ? error.message : String(error)}. The existing context remains.`,
					"error",
				);
				return { cancel: true };
			}
			return;
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
			!this.active ||
			this.normalCompaction ||
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
		if (!pending.instructions?.trim() && this.fresh(ctx))
			await this.roll(ctx, false);
		else this.startCheckpoint(ctx, pending.instructions);
	}
	async settled(
		event: AgentSettledEvent,
		ctx: ExtensionContext,
	): Promise<void> {
		const checkpoint = this.checkpoint;
		this.checkpoint = undefined;
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
					aborted: event.aborted,
				});
		} catch (error) {
			this.rollover = undefined;
			if (
				checkpoint &&
				(event.aborted ||
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
				event.aborted ||
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
			await this.roll(ctx, false);
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
			rollover.sessionId === ctx.sessionManager.getSessionId() &&
			rollover.windowId === this.windows.current?.currentWindowId
		) {
			this.rollover = undefined;
			await this.roll(ctx, rollover.triggerTurn);
		}
	}
}
