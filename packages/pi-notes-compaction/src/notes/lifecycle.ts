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
import type { NotesBridge } from "./bridge.js";
import { FreshCheckpoint } from "./fresh-checkpoint.js";
import {
	hasFreshNotes,
	hasPrecedingNoteWrite,
	NOTES_RUN_ENTRY,
} from "./fresh-notes.js";
import { IdleAdmission } from "./idle-admission.js";
import type { ModelRoleHandoff } from "./model-roles.js";
import { noteHints, sessionRef } from "./notes.js";
import { RolloverRequests } from "./rollover.js";
import {
	branchBackwards,
	currentRun,
	findRolloverTail,
	type RolloverTail,
} from "./rollover-tail.js";
import type {
	IdleMinutes,
	NewWindowRequests,
	RolloverTailMode,
} from "./settings.js";
import { savedNotesIdentity } from "./shared-notes.js";
import type { NotesStore } from "./store.js";
import { selectedWindowRole } from "./window-message.js";
import {
	SETTLEMENT_ENTRY,
	WINDOW_MESSAGE,
	Windows,
	windowDetails,
	windowMessage,
} from "./windows.js";

// Public event coordinator owns window identity and orders settlement before admissions.
export class NotesLifecycle {
	readonly windows = new Windows();
	active = false;
	normalCompaction = false;
	newWindowRequests: NewWindowRequests = "unrestricted";
	taskCompletionRollover = false;
	idleMinutes: IdleMinutes = 0;
	rolloverTail: RolloverTailMode = "off";
	taskBoundaryReminder = 0;
	bridge: NotesBridge | undefined;
	prepareReminder: NotesBridge["prepareReminder"];
	prepareWindow: ((ctx: ExtensionContext) => Promise<void>) | undefined;
	commitWindow: ((ctx: ExtensionContext) => Promise<void>) | undefined;
	runId = "";
	private readonly checkpoint: FreshCheckpoint;
	private readonly admission: IdleAdmission;
	private readonly requests: RolloverRequests;

	private readonly pi: ExtensionAPI;
	private readonly store: NotesStore;
	constructor(pi: ExtensionAPI, store: NotesStore) {
		this.pi = pi;
		this.store = store;
		this.checkpoint = new FreshCheckpoint(this, (message, options) =>
			this.sendMessage(message, options),
		);
		this.requests = new RolloverRequests(
			this,
			(ctx, triggerTurn, trim, handoff, tail) =>
				this.openWindow(ctx, triggerTurn, trim, handoff, tail),
			(message, options) => this.sendMessage(message, options),
			(ctx, instructions) => this.rollNotes(ctx, instructions),
		);
		this.admission = new IdleAdmission(
			this,
			pi,
			(ctx, source) =>
				this.normalCompaction || source === "custom"
					? this.requests.roll(
							ctx,
							false,
							undefined,
							undefined,
							this.normalCompaction ? undefined : this.retainedTail(ctx),
						)
					: this.rollNotes(ctx),
			() => this.requests.pending,
			() => this.checkpoint.pending,
		);
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
		this.pi.sendMessage(this.prepareReminder?.(draft) ?? draft, options);
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
		this.admission.reset();
		this.checkpoint.reset();
		this.requests.reset();
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
		this.checkpoint.bind(event, this.runId);
		return message
			? { message: this.prepareReminder?.(message) ?? message }
			: undefined;
	}
	fresh(ctx: ExtensionContext, runId?: string): boolean {
		if (runId)
			return hasFreshNotes(
				currentRun(ctx.sessionManager, runId) ?? [],
				this.windows.current?.currentWindowId,
				runId,
			);
		return hasFreshNotes(
			ctx.sessionManager.getBranch(),
			this.windows.current?.currentWindowId,
		);
	}
	private retainedTail(ctx: ExtensionContext): RolloverTail | undefined {
		const windowId = this.windows.current?.currentWindowId;
		if (windowId && this.rolloverTail !== "off")
			return findRolloverTail(ctx.sessionManager, windowId, this.rolloverTail);
	}
	private async rollNotes(
		ctx: ExtensionContext,
		instructions?: string,
	): Promise<void> {
		if (!instructions?.trim()) {
			const tail = this.retainedTail(ctx);
			if (tail || (this.rolloverTail === "off" && this.fresh(ctx))) {
				await this.requests.roll(ctx, false, undefined, undefined, tail);
				return;
			}
		}
		await this.checkpoint.start(ctx, instructions);
	}
	requestRollover(
		ctx: ExtensionContext,
		callId: string,
		handoff?: ModelRoleHandoff,
		resume = true,
		parentCallId?: string,
	): boolean {
		if (this.newWindowRequests === "off")
			throw new Error(
				"New window requests are disabled. Continue in the current window.",
			);
		if (!resume && !this.taskCompletionRollover)
			throw new Error(
				"Task-completion rollover is disabled. Continue here, or use new_context without resume: false.",
			);
		if (this.checkpoint.pending || this.admission.pending) return false;
		if (this.requests.pending) return false;
		if (
			!hasPrecedingNoteWrite(
				ctx.sessionManager.getBranch(),
				this.windows.current?.currentWindowId,
				this.runId,
				callId,
				parentCallId,
			)
		)
			throw new Error(
				"Save your progress in your own notes using a relative path, wait for the write to succeed, then call new_context next. Writing another agent's notes does not save your checkpoint.",
			);
		this.requests.schedule(ctx, handoff, resume);
		return true;
	}
	private async openWindow(
		ctx: ExtensionContext,
		triggerTurn: boolean,
		trim: boolean,
		handoff?: ModelRoleHandoff,
		tail?: RolloverTail,
	): Promise<void> {
		if (!ctx.isIdle())
			throw new Error("Wait for the current run to settle before rollover");
		const sessionId = ctx.sessionManager.getSessionId();
		const windowId = this.windows.current?.currentWindowId;
		const leaf = ctx.sessionManager.getLeafId();
		if (trim) await this.prepareWindow?.(ctx);
		const assertCurrentWindow = () => {
			if (
				!ctx.isIdle() ||
				sessionId !== ctx.sessionManager.getSessionId() ||
				windowId !== this.windows.current?.currentWindowId ||
				!this.active
			)
				throw new Error("Session changed before rollover");
		};
		assertCurrentWindow();
		if (
			tail &&
			leaf !== ctx.sessionManager.getLeafId() &&
			this.retainedTail(ctx)?.firstKeptEntryId !== tail.firstKeptEntryId
		)
			throw new Error("Saved checkpoint changed before rollover");
		// Prepare the outgoing provider first; the successor's full kickoff sees the new model.
		if (handoff) {
			await handoff.activate(ctx);
			assertCurrentWindow();
		}
		const ids = this.windows.next();
		const hint = noteHints(this.store, ctx, this.agent(ctx));
		const message = windowMessage(
			ids,
			this.agent(ctx),
			hint,
			trim,
			"window",
			handoff?.id ?? selectedWindowRole(ctx.sessionManager.getBranch()),
			tail,
		);
		this.windows.current = ids;
		if (triggerTurn)
			message.content = `${message.content}\n\nContinuation: read relevant notes, then resume any unfinished task. Follow current instructions.`;
		this.sendMessage(message, { triggerTurn });
		if (tail) await this.commitWindow?.(ctx);
	}

	prepareCustomTurn(ctx: ExtensionContext): Promise<void> | undefined {
		return this.admission.prepareCustomTurn(ctx);
	}
	outcome(outcome: "completed" | "aborted" | "error"): void {
		this.checkpoint.outcome(outcome);
		this.requests.outcome(outcome);
	}
	input(
		event: InputEvent,
		ctx: ExtensionContext,
	): Promise<InputEventResult | undefined> {
		return this.admission.input(event, ctx);
	}
	beforeCompact(
		event: SessionBeforeCompactEvent,
		ctx: ExtensionContext,
	): { cancel: true } | undefined {
		return this.requests.beforeCompact(event, ctx);
	}
	allowsCompaction(reason: SessionBeforeCompactEvent["reason"]): boolean {
		return this.requests.allowsCompaction(reason);
	}
	compactFailed(
		event: SessionCompactFailedEvent,
		ctx: ExtensionContext,
	): Promise<void> {
		return this.requests.compactFailed(event, ctx);
	}
	async settled(
		event: AgentSettledEvent,
		ctx: ExtensionContext,
	): Promise<void> {
		const checkpoint = this.checkpoint.take();
		try {
			this.store.updateFile(sessionRef(ctx));
			const terminal = branchBackwards(ctx.sessionManager).find(
				(entry) => entry.type === "message" && entry.message.role !== "system",
			);
			if (terminal && this.windows.current) {
				const windowId = this.windows.current.currentWindowId;
				this.pi.appendEntry(SETTLEMENT_ENTRY, {
					protocol: 1,
					windowId,
					completedEntryId: terminal.id,
					settledAt: Date.now(),
					aborted: event.aborted,
				});
			}
		} catch (error) {
			this.requests.clear();
			checkpoint?.finish(error);
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
			} else if (this.admission.pending) this.admission.fail(ctx, error);
			else throw error;
			return;
		}
		if (checkpoint) {
			try {
				if (!this.checkpoint.permitsRollover(checkpoint, event, ctx))
					throw new Error(
						"No completed checkpoint; the current context remains",
					);
				const tail = this.retainedTail(ctx);
				if (this.rolloverTail !== "off" && !tail)
					throw new Error(
						"No eligible saved checkpoint; the current context remains",
					);
				await this.requests.roll(ctx, false, undefined, undefined, tail);
				checkpoint.finish();
			} catch (error) {
				checkpoint.finish(error);
			}
			return;
		}
		if (this.admission.drain()) return;
		const rollover = this.requests.settled(ctx, event.aborted);
		if (rollover) await rollover;
	}
}
