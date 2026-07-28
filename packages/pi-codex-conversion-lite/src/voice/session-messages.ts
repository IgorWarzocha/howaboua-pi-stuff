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
		// Session history stays append-only: hold voice messages while Pi is active,
		// then append state/conversation cards and stop after one turn-triggering delegation.
		const ctx = this.context;
		if (this.piTurnActive || !ctx?.isIdle()) return;
		while (this.pending.length > 0) {
			const message = this.pending.shift()!;
			if (message.type === "mode") {
				this.pi.sendMessage(codexVoiceModeMessage(message.mode, message.state), { triggerTurn: false });
				continue;
			}
			const { turn } = message;
			if (turn.delegationId) {
				if (!this.callbacks.canDelegate()) continue;
				this.callbacks.onDelegation(turn.delegationId);
				this.backendTurnPending = true;
				this.piTurnActive = true;
				this.callbacks.onWorking();
				// User-message routing runs Pi's normal before_agent_start pipeline. A
				// triggerTurn custom message bypasses it and can lose per-turn capabilities.
				this.pi.sendUserMessage(turn.input);
				return;
			}
			this.pi.sendMessage(realtimeVoiceMessage(turn.input, "conversation"), { triggerTurn: false });
		}
		if (!this.callbacks.isVoiceActive()) this.context = undefined;
	}
}
