import { randomUUID } from "node:crypto";
import type {
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
import type { ContextManagementMode } from "../adapter/activation/config.ts";
import {
	type StartContextWindowOptions,
	CodexContextWindowManager,
} from "./window-manager.ts";

export interface StartContextWindowKickoffOptions extends StartContextWindowOptions {
	triggerTurn: boolean;
}

interface PendingContinuation {
	sessionId: string;
	windowId: string;
	input?: Parameters<ExtensionAPI["sendUserMessage"]>[0] | undefined;
}

interface PendingIdleInput {
	sessionId: string;
	admissions: Array<(result: InputEventResult) => void>;
	preparation?: Promise<void>;
}

interface IdleCheckpoint {
	sessionId: string;
	prompt: string;
	admitted: boolean;
	aborted: boolean;
	settlementReached: boolean;
	stopObserving?: () => void;
	resolve: () => void;
	reject: (error: Error) => void;
}

export class CodexContextWindowKickoff {
	private readonly windows: CodexContextWindowManager;
	private readonly onContinue: ((input: Parameters<ExtensionAPI["sendUserMessage"]>[0]) => void) | undefined;
	private continuation: PendingContinuation | undefined;
	private idleInput: PendingIdleInput | undefined;
	private idleCheckpoint: IdleCheckpoint | undefined;

	constructor(
		windows: CodexContextWindowManager,
		onContinue?: (input: Parameters<ExtensionAPI["sendUserMessage"]>[0]) => void,
	) {
		this.windows = windows;
		this.onContinue = onContinue;
	}

	reset(): void {
		this.continuation = undefined;
		for (const admit of this.idleInput?.admissions ?? []) admit({ action: "handled" });
		this.idleInput = undefined;
		this.idleCheckpoint?.stopObserving?.();
		this.idleCheckpoint?.reject(new Error("Idle context checkpoint was cancelled"));
		this.idleCheckpoint = undefined;
	}

	get pending(): boolean {
		return this.continuation !== undefined;
	}

	get hasIdleInput(): boolean {
		return this.idleInput !== undefined;
	}

	get hasIdleCheckpoint(): boolean {
		return this.idleCheckpoint !== undefined;
	}

	/** Only our distinct checkpoint kickoff bypasses held user admissions. */
	admitCheckpointInput(event: InputEvent): boolean {
		const pending = this.idleCheckpoint;
		if (!pending || pending.admitted || event.source !== "extension" || event.text !== pending.prompt) return false;
		pending.admitted = true;
		return true;
	}

	async prepareIdleCheckpoint(pi: ExtensionAPI, ctx: ExtensionContext, mode: ContextManagementMode): Promise<void> {
		if (!this.idleInput || this.idleCheckpoint || !ctx.isIdle())
			throw new Error("The session must be idle before saving a context checkpoint");
		let pending!: IdleCheckpoint;
		const completed = new Promise<void>((resolve, reject) => {
			pending = { sessionId: ctx.sessionManager.getSessionId(),
				prompt: `Save the requested context checkpoint. Checkpoint request: ${randomUUID()}`,
				admitted: false, aborted: false, settlementReached: false, resolve, reject };
		});
		this.idleCheckpoint = pending;
		try {
			ctx.ui.notify("Saving notes before idle rollover. Your input and attachments are pending. If no turn starts, reload the session to cancel pending input.", "info");
			this.windows.promptNotesCheckpoint(pi, ctx, mode, undefined, pending.prompt);
			await completed;
		} finally {
			pending.stopObserving?.();
			if (this.idleCheckpoint === pending) this.idleCheckpoint = undefined;
		}
	}

	finishIdleCheckpoint(ctx: ExtensionContext, result: "ready" | "missing" | undefined): void {
		const pending = this.idleCheckpoint;
		if (!pending) return;
		const terminal = ctx.sessionManager.getBranch().findLast(entry => entry.type === "message" && entry.message.role === "assistant");
		// Pi skips before-settle on explicit abort, including cancellation between retries
		// when there is no active core signal and the last reply still says error.
		if (!pending.settlementReached || pending.aborted || terminal?.type === "message" && terminal.message.role === "assistant" && terminal.message.stopReason === "aborted") {
			this.reset();
			ctx.ui.notify("Idle checkpoint cancelled. Pending input and attachments were not submitted. Resubmit them to continue.", "warning");
			return;
		}
		if (pending.sessionId === ctx.sessionManager.getSessionId() && ctx.isIdle() && result === "ready") pending.resolve();
		else pending.reject(new Error("The checkpoint run ended without fresh saved notes"));
	}

	observeCheckpointRun(signal: AbortSignal | undefined): void {
		const pending = this.idleCheckpoint;
		if (!pending || !signal) return;
		pending.stopObserving?.();
		const aborted = () => { pending.aborted = true; };
		if (signal.aborted) aborted();
		else signal.addEventListener("abort", aborted, { once: true });
		pending.stopObserving = () => signal.removeEventListener("abort", aborted);
	}

	recordCheckpointOutcome(outcome: "completed" | "aborted" | "error"): void {
		if (!this.idleCheckpoint) return;
		this.idleCheckpoint.settlementReached = true;
		if (outcome === "aborted") this.idleCheckpoint.aborted = true;
	}

	/** Hold the original SDK prompt at input, before expansion and preparation. */
	async prepareIdleInput(
		ctx: ExtensionContext,
		rollover: () => Promise<boolean>,
	): Promise<InputEventResult> {
		const sessionId = ctx.sessionManager.getSessionId();
		const pending = this.idleInput ?? { sessionId, admissions: [] };
		this.idleInput = pending;
		// Reentrant inputs keep their original SDK calls, options and later input hooks.
		// Only the rollover is shared. Pi still owns streaming/queue admission.
		const admission = new Promise<InputEventResult>((resolve) => pending.admissions.push(resolve));
		if (pending.preparation) return admission;
		pending.preparation = Promise.resolve().then(async () => {
			try {
				if (this.idleInput !== pending) return;
				if (pending.sessionId !== sessionId || !ctx.isIdle())
					throw new Error("The original session must be idle before retrying rollover");
				if (!await rollover()) throw new Error("A new context window could not be started");
				if (this.idleInput !== pending || ctx.sessionManager.getSessionId() !== sessionId)
					throw new Error("The session changed during rollover");
				this.idleInput = undefined;
				for (const admit of pending.admissions) admit({ action: "continue" });
			} catch (error) {
				delete pending.preparation;
				if (this.idleInput !== pending) return;
				ctx.ui.notify(`Idle context rollover failed: ${error instanceof Error ? error.message : String(error)}. Input and attachments are still pending. Submit another prompt to retry, or reload the session to cancel pending input.`, "error");
			}
		});
		return admission;
	}

	async startWindow(
		pi: ExtensionAPI,
		ctx: ExtensionContext,
		options: StartContextWindowKickoffOptions,
	): Promise<boolean> {
		const { triggerTurn, ...windowOptions } = options;
		const started = await this.windows.startNewWindow(pi, ctx, windowOptions);
		if (!started) return false;
		this.continuation = undefined;
		if (!triggerTurn) return true;
		const identity = this.windows.currentIdentity();
		if (!identity) throw new Error("The new context window has no identity");
		this.continuation = {
			sessionId: ctx.sessionManager.getSessionId(),
			windowId: identity.currentWindowId,
		};
		return true;
	}

	queueInput(content: Parameters<ExtensionAPI["sendUserMessage"]>[0]): void {
		if (!this.continuation)
			throw new Error("No context-window continuation can accept queued input");
		this.continuation.input = content;
	}

	continue(pi: ExtensionAPI, ctx: ExtensionContext): boolean {
		const pending = this.continuation;
		if (!pending) return false;
		if (
			pending.sessionId !== ctx.sessionManager.getSessionId() ||
			pending.windowId !== this.windows.currentIdentity()?.currentWindowId
		) {
			this.continuation = undefined;
			return false;
		}
		if (!ctx.isIdle()) return false;
		this.continuation = undefined;
		const input = pending.input ?? "Continue.";
		this.onContinue?.(input);
		// Only settled user input enters Pi's complete before_agent_start chain.
		pi.sendUserMessage(
			input,
			pending.input === undefined ? undefined : { expandPromptTemplates: true },
		);
		return true;
	}
}
