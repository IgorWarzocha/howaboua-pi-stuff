import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { RealtimeVoiceTurn } from "./turns.ts";
import { codexVoiceModeMessage, realtimeVoiceMessage, type CodexVoiceMode, type CodexVoiceModeState } from "./ui.ts";

type PendingVoiceMessage =
	| { type: "mode"; mode: CodexVoiceMode; state: CodexVoiceModeState }
	| { type: "turn"; turn: RealtimeVoiceTurn };

export interface CodexVoiceSessionMessageCallbacks {
	canDelegate(): boolean;
	isVoiceActive(): boolean;
	onDelegation(id: string): void;
	onWorking(): void;
}

export class CodexVoiceSessionMessages {
	private readonly pi: ExtensionAPI;
	private readonly callbacks: CodexVoiceSessionMessageCallbacks;
	private context: ExtensionContext | undefined;
	private pending: PendingVoiceMessage[] = [];
	private piTurnActive = false;
	private backendTurnPending = false;
	private dictationAnnounced = false;

	constructor(pi: ExtensionAPI, callbacks: CodexVoiceSessionMessageCallbacks) {
		this.pi = pi;
		this.callbacks = callbacks;
	}

	setContext(ctx: ExtensionContext): void {
		this.context = ctx;
		this.piTurnActive = !ctx.isIdle();
	}

	modeStarted(mode: CodexVoiceMode): void {
		if (mode === "dictation") {
			if (this.dictationAnnounced) return;
			this.dictationAnnounced = true;
		}
		this.enqueueMode(mode, "started");
	}

	resetContextAnnouncements(): void {
		this.dictationAnnounced = false;
	}

	voiceStopped(mode?: CodexVoiceMode): void {
		this.backendTurnPending = false;
		this.piTurnActive = this.context ? !this.context.isIdle() : false;
		if (mode && mode !== "dictation") this.enqueueMode(mode, "ended");
		else this.flush();
	}

	voiceTurn(turn: RealtimeVoiceTurn): void {
		const ctx = this.context;
		if (turn.delegationId && ctx && !ctx.isIdle()) {
			this.deliverDelegation(turn, false);
			return;
		}
		this.pending.push({ type: "turn", turn });
		this.flush();
	}

	consumeDelegatedTurnStart(): boolean {
		if (!this.backendTurnPending) return false;
		this.backendTurnPending = false;
		return true;
	}

	agentStarted(): void {
		this.piTurnActive = true;
	}

	agentSettled(): void {
		this.piTurnActive = false;
		this.flush();
	}

	private enqueueMode(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
		this.pending.push({ type: "mode", mode, state });
		this.flush();
	}

	private flush(): void {
		const ctx = this.context;
		if (!ctx) return;
		const deliverAs = this.piTurnActive || !ctx.isIdle() ? "steer" : undefined;
		while (this.pending.length > 0) {
			const message = this.pending.shift();
			if (!message) break;
			if (message.type === "mode") {
				this.pi.sendMessage(codexVoiceModeMessage(message.mode, message.state), { triggerTurn: false, ...(deliverAs ? { deliverAs } : {}) });
				continue;
			}
			const { turn } = message;
			if (turn.delegationId) {
				if (!this.deliverDelegation(turn, !deliverAs)) continue;
				return;
			}
			this.pi.sendMessage(realtimeVoiceMessage(turn.input, "conversation"), { triggerTurn: false, ...(deliverAs ? { deliverAs } : {}) });
		}
		if (!this.callbacks.isVoiceActive()) this.context = undefined;
	}

	private deliverDelegation(turn: RealtimeVoiceTurn, startsTurn: boolean): boolean {
		if (!turn.delegationId || !this.callbacks.canDelegate()) return false;
		this.callbacks.onDelegation(turn.delegationId);
		if (startsTurn) this.backendTurnPending = true;
		this.piTurnActive = true;
		this.callbacks.onWorking();
		// Keep Pi's user-input pipeline; custom trigger-turn messages bypass
		// before_agent_start and can lose per-turn capabilities.
		this.pi.sendUserMessage(turn.input, startsTurn ? undefined : { deliverAs: "steer" });
		return true;
	}
}
