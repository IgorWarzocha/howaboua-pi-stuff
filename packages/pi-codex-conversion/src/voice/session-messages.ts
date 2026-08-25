import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CANCELLED, interruptible } from "./cancellation.ts";
import { isVoiceContextExcludedMessage } from "./context-visibility.ts";
import { renderRealtimeTranscriptTail } from "./prompts.ts";
import type { RealtimeVoiceTurn } from "./turns.ts";
import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	type CodexVoiceMode,
	type CodexVoiceModeMessageDetails,
	type CodexVoiceModeState,
	codexVoiceModeMessage,
	REALTIME_DELEGATION_MESSAGE_TYPE,
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
	type RealtimeUserTranscriptMessageDetails,
	type RealtimeVoiceMessageDetails,
	realtimeVoiceMessage,
	VOICE_CONTEXT_MESSAGE_TYPE,
} from "./ui.ts";

const REALTIME_VOICE_TAIL_CONTEXT_TYPE = "codex-realtime-voice-tail";

export interface PreparedVoiceDelegation {
	commit(): boolean;
	rollback(): void;
}

export interface CodexVoiceSessionMessageCallbacks {
	canDelegate(): boolean;
	prepareDelegation(ctx: ExtensionContext, signal: AbortSignal): Promise<PreparedVoiceDelegation | undefined>;
	onDelegation(id: string): void;
	onDelegationFailed(id: string): void;
	onWorking(): void;
}

export class CodexVoiceSessionMessages {
	private readonly pi: ExtensionAPI;
	private readonly callbacks: CodexVoiceSessionMessageCallbacks;
	private context: ExtensionContext | undefined;
	private piTurnActive = false;
	private dictationAnnounced = false;
	private delegationTail: Promise<void> = Promise.resolve();
	private delegationAbortController = new AbortController();
	private compactionBarrier:
		| ReturnType<typeof Promise.withResolvers<void>>
		| undefined;
	private contextGeneration = 0;

	constructor(pi: ExtensionAPI, callbacks: CodexVoiceSessionMessageCallbacks) {
		this.pi = pi;
		this.callbacks = callbacks;
	}

	setContext(ctx: ExtensionContext): void {
		this.replaceContext(ctx);
		this.piTurnActive = !ctx.isIdle();
	}

	contextSummary(summary: string): void {
		this.pi.appendEntry(VOICE_CONTEXT_MESSAGE_TYPE, { summary });
	}

	userTranscript(transcript: string): void {
		this.pi.appendEntry<RealtimeUserTranscriptMessageDetails>(
			REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
			{ transcript },
		);
	}

	modeStarted(mode: CodexVoiceMode): void {
		if (mode === "dictation") {
			if (this.dictationAnnounced) return;
			this.dictationAnnounced = true;
		}
		this.appendMode(mode, "started");
	}

	resetContextAnnouncements(): void {
		this.dictationAnnounced = false;
	}

	resetSessionContext(): void {
		this.compactionFinished();
		this.replaceContext(undefined);
		this.piTurnActive = false;
	}

	conversationInputStopped(): void {
		this.appendMode("realtime", "ended");
	}

	voiceStopped(mode?: CodexVoiceMode): void {
		this.piTurnActive = this.context ? !this.context.isIdle() : false;
		if (mode && mode !== "dictation") this.appendMode(mode, "ended");
		this.replaceContext(undefined);
	}

	voiceTurn(turn: RealtimeVoiceTurn): Promise<void> {
		if (!turn.delegationId) {
			this.pi.appendEntry<RealtimeVoiceMessageDetails>(
				REALTIME_VOICE_MESSAGE_TYPE,
				{
					input: turn.input,
					route: "conversation",
				},
			);
			return Promise.resolve();
		}
		const generation = this.contextGeneration;
		const canDeliver = this.callbacks.canDelegate();
		const delivery = this.delegationTail.then(() =>
			this.deliverDelegation(turn, generation, canDeliver),
		);
		this.delegationTail = delivery.catch(() => undefined);
		return delivery;
	}

	waitForDelegations(): Promise<void> {
		return this.delegationTail;
	}

	cancelPendingDelegations(): void {
		this.delegationAbortController.abort();
	}

	compactionStarted(): void {
		this.compactionBarrier ??= Promise.withResolvers<void>();
	}

	compactionFinished(): void {
		this.compactionBarrier?.resolve();
		this.compactionBarrier = undefined;
	}

	retainTranscriptTail(transcriptDelta: string): void {
		const piTurnActive =
			this.piTurnActive || (this.context ? !this.context.isIdle() : false);
		this.pi.sendMessage(
			{
				customType: REALTIME_VOICE_TAIL_CONTEXT_TYPE,
				content: renderRealtimeTranscriptTail(transcriptDelta),
				display: false,
				details: {},
			},
			{
				triggerTurn: false,
				deliverAs: piTurnActive ? "nextTurn" : "steer",
			},
		);
	}

	filterContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
		return messages.filter(
			(message) => !isVoiceContextExcludedMessage(message),
		);
	}

	agentStarted(): void {
		this.piTurnActive = true;
	}

	agentSettled(): void {
		this.piTurnActive = false;
	}

	private appendMode(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
		if (mode === "realtime") {
			this.pi.sendMessage(codexVoiceModeMessage(mode, state), {
				triggerTurn: false,
				deliverAs: "steer",
			});
			return;
		}
		this.pi.appendEntry<CodexVoiceModeMessageDetails>(
			CODEX_VOICE_MODE_MESSAGE_TYPE,
			{ mode, state },
		);
	}

	private replaceContext(ctx: ExtensionContext | undefined): void {
		this.delegationAbortController.abort();
		this.delegationAbortController = new AbortController();
		this.contextGeneration++;
		this.delegationTail = Promise.resolve();
		this.context = ctx;
	}

	private async deliverDelegation(
		turn: RealtimeVoiceTurn,
		generation: number,
		canDeliver: boolean,
	): Promise<void> {
		const ctx = this.context;
		if (
			generation !== this.contextGeneration ||
			!ctx ||
			!turn.delegationId ||
			!canDeliver
		) return;
		const signal = this.delegationAbortController.signal;
		let preflight: PreparedVoiceDelegation | undefined;
		let deliveryStarted = false;
		let failureAction = "prepare";
		try {
			for (;;) {
				for (;;) {
					const barrier = this.compactionBarrier;
					if (!barrier) break;
					if ((await interruptible(barrier.promise, signal)) === CANCELLED)
						signal.throwIfAborted();
					if (
						generation !== this.contextGeneration ||
						this.context !== ctx
					) return;
				}
				let startsTurn = !this.piTurnActive && ctx.isIdle();
				if (!startsTurn) break;
				preflight = await this.callbacks.prepareDelegation(ctx, signal);
				if (
					generation !== this.contextGeneration ||
					this.context !== ctx
				) return;
				if (this.compactionBarrier) {
					preflight = undefined;
					continue;
				}
				startsTurn = !this.piTurnActive && ctx.isIdle();
				if (!startsTurn) break;
				deliveryStarted = true;
				if (preflight?.commit() !== false) break;
				deliveryStarted = false;
				preflight = undefined;
			}
			const startsTurn = !this.piTurnActive && ctx.isIdle();
			failureAction = "deliver";
			deliveryStarted = true;
			this.callbacks.onDelegation(turn.delegationId);
			this.piTurnActive = true;
			this.callbacks.onWorking();
			this.pi.sendMessage(
				realtimeVoiceMessage(turn.input, "delegation", turn.transcriptDelta),
				startsTurn
					? { triggerTurn: true }
					: { triggerTurn: true, deliverAs: "steer" },
			);
		} catch (error) {
			if (
				generation !== this.contextGeneration ||
				this.context !== ctx
			) return;
			if (deliveryStarted) {
				try { preflight?.rollback(); } catch {}
				try {
					this.piTurnActive = this.context ? !this.context.isIdle() : false;
				} catch {
					this.piTurnActive = false;
				}
				try { this.callbacks.onDelegationFailed(turn.delegationId); } catch {}
			}
			const message = signal.aborted
				? "Voice session stopped before the delegation was prepared"
				: error instanceof Error ? error.message : String(error);
			if (!signal.aborted) {
				try {
					ctx.ui.notify(
						`Could not ${failureAction} voice delegation: ${message}`,
						"error",
					);
				} catch {}
			}
			try {
				this.pi.appendEntry<RealtimeVoiceMessageDetails>(
					REALTIME_DELEGATION_MESSAGE_TYPE,
					{ input: turn.input, route: "delegation", error: message },
				);
			} catch {}
		}
	}
}
