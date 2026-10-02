import type {
	ExtensionAPI,
	ExtensionContext,
	InputEventResult,
} from "@earendil-works/pi-coding-agent";
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

export class CodexContextWindowKickoff {
	private readonly windows: CodexContextWindowManager;
	private readonly onContinue: ((input: Parameters<ExtensionAPI["sendUserMessage"]>[0]) => void) | undefined;
	private continuation: PendingContinuation | undefined;
	private idleInput: PendingIdleInput | undefined;

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
	}

	get pending(): boolean {
		return this.continuation !== undefined;
	}

	get hasIdleInput(): boolean {
		return this.idleInput !== undefined;
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
				ctx.ui.notify(`Idle context rollover failed: ${error instanceof Error ? error.message : String(error)}. Input and attachments are still pending. Submit another prompt to retry.`, "error");
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
