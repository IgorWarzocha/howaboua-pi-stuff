import type {
	ExtensionAPI,
	ExtensionContext,
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

export class CodexContextWindowKickoff {
	private readonly windows: CodexContextWindowManager;
	private readonly onContinue: ((input: Parameters<ExtensionAPI["sendUserMessage"]>[0]) => void) | undefined;
	private continuation: PendingContinuation | undefined;
	private postCompactionWindow: {
		sessionId: string;
		options: StartContextWindowKickoffOptions;
	} | undefined;

	constructor(
		windows: CodexContextWindowManager,
		onContinue?: (input: Parameters<ExtensionAPI["sendUserMessage"]>[0]) => void,
	) {
		this.windows = windows;
		this.onContinue = onContinue;
	}

	reset(): void {
		this.continuation = undefined;
		this.postCompactionWindow = undefined;
	}

	get pending(): boolean {
		return this.continuation !== undefined || this.postCompactionWindow !== undefined;
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

	schedulePostCompactionWindow(
		ctx: ExtensionContext,
		options: StartContextWindowKickoffOptions,
	): void {
		this.postCompactionWindow = {
			sessionId: ctx.sessionManager.getSessionId(),
			options,
		};
	}

	async settlePostCompaction(pi: ExtensionAPI, ctx: ExtensionContext): Promise<boolean> {
		const pending = this.postCompactionWindow;
		this.postCompactionWindow = undefined;
		if (!pending || pending.sessionId !== ctx.sessionManager.getSessionId()) return false;
		return this.startWindow(pi, ctx, pending.options);
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
