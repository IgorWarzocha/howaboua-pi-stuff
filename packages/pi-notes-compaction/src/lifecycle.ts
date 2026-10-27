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
import { noteHints, sessionRef } from "./notes.js";
import { RolloverRequests } from "./rollover.js";
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

// Public event coordinator owns window identity and orders settlement before admissions.
export class NotesLifecycle {
	readonly windows = new Windows();
	gptPromptMode = () => false;
	active = false;
	normalCompaction = false;
	newWindowRequests: NewWindowRequests = "unrestricted";
	idleMinutes: IdleMinutes = 0;
	taskBoundaryReminder = 0;
	bridge: NotesBridge | undefined;
	prepareReminder: NotesBridge["prepareReminder"];
	prepareWindow: ((ctx: ExtensionContext) => Promise<void>) | undefined;
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
			(ctx, triggerTurn, trim) => this.openWindow(ctx, triggerTurn, trim),
			(message, options) => this.sendMessage(message, options),
			(ctx, instructions) => this.checkpoint.start(ctx, instructions),
		);
		this.admission = new IdleAdmission(
			this,
			pi,
			(ctx, triggerTurn) => this.requests.roll(ctx, triggerTurn),
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
		this.checkpoint.bind(event, this.runId);
		return message
			? { message: this.prepareReminder?.(message) ?? message }
			: undefined;
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
		if (this.checkpoint.pending || this.admission.pending) return false;
		if (this.requests.pending) return false;
		if (
			!hasPrecedingNoteWrite(
				ctx.sessionManager.getBranch(),
				this.windows.current?.currentWindowId,
				this.runId,
				callId,
			)
		)
			throw new Error(
				"Save your progress in your own notes using a relative path, wait for the write to succeed, then call new_context next. Writing another agent's notes does not save your checkpoint.",
			);
		this.requests.schedule(ctx);
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
		const windowId = this.windows.current?.currentWindowId;
		if (trim) await this.prepareWindow?.(ctx);
		if (
			!ctx.isIdle() ||
			sessionId !== ctx.sessionManager.getSessionId() ||
			windowId !== this.windows.current?.currentWindowId ||
			!this.active
		)
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
			message.content = `${message.content}\n\n${this.gptPromptMode() ? "Saved notes→notes tool→resume task" : "Read your saved notes with the notes tool and resume the task."}`;
		this.sendMessage(message, { triggerTurn });
	}

	prepareCustomTurn(ctx: ExtensionContext): Promise<void> | undefined {
		return this.admission.prepareCustomTurn(ctx);
	}
	outcome(outcome: "completed" | "aborted" | "error"): void {
		this.checkpoint.outcome(outcome);
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
			this.requests.clear();
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
			if (!this.checkpoint.permitsRollover(checkpoint, event, ctx)) return;
			await this.requests.roll(ctx, false);
			return;
		}
		if (this.admission.drain()) return;
		const rollover = this.requests.settled(ctx);
		if (rollover) await rollover;
	}
}
