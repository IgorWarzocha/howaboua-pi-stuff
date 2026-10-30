import { admitCustomTurn } from "../custom-turn-admission.ts";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { trySendCodexDeveloperCustomMessage } from "../developer-messages.ts";
import { CANCELLED, interruptible } from "./cancellation.ts";
import { isVoiceContextExcludedMessage } from "./context-visibility.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { RealtimeVoiceEventDetails } from "./conversation/wire.ts";
import { REALTIME_EVENT_ENTRY_TYPE } from "./message-types.ts";
import { renderRealtimeTranscriptTail, renderRealtimeUserInput } from "./prompts.ts";
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
	VOICE_CONTEXT_MESSAGE_TYPE,
} from "./ui.ts";

const REALTIME_VOICE_TAIL_CONTEXT_TYPE = "codex-realtime-voice-tail";

export interface CodexVoiceSessionMessageCallbacks {
	canDelegate(): boolean;
	onDelegation(id: string, input: string, source: CodexRealtimeConversation | undefined): void;
	onDelegationFailed(id: string): void;
	onDeliveryUnavailable(message: string): void;
	onWorking(): void;
}

export class CodexVoiceSessionMessages {
	private readonly pi: ExtensionAPI;
	private readonly callbacks: CodexVoiceSessionMessageCallbacks;
	private context: ExtensionContext | undefined;
	private piTurnActive = false;
	private dictationAnnounced = false;
	private readonly pendingDelegations = new Map<string, () => void>();
	private delegationTail: Promise<void> = Promise.resolve();
	private delegationAbortController = new AbortController();
	private compactionBarrier:
		| ReturnType<typeof Promise.withResolvers<void>>
		| undefined;
	private contextGeneration = 0;
	private readonly refreshBarriers = new Set<Promise<void>>();

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

	realtimeEvent(event: RealtimeVoiceEventDetails): void {
		this.pi.appendEntry(REALTIME_EVENT_ENTRY_TYPE, event);
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

	voiceTurn(turn: RealtimeVoiceTurn, source?: CodexRealtimeConversation): Promise<void> {
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
		const canDeliver = source?.finishingAcceptedWork || this.callbacks.canDelegate();
		const delivery = this.delegationTail.then(() =>
			this.deliverDelegation(turn, generation, canDeliver, source),
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

	holdDelegationsForRefresh(): () => void {
		const barrier = Promise.withResolvers<void>();
		this.refreshBarriers.add(barrier.promise);
		return () => {
			this.refreshBarriers.delete(barrier.promise);
			barrier.resolve();
		};
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

	delegationConsumed(message: unknown): boolean {
		if (!message || typeof message !== "object") return false;
		const candidate = message as {
			role?: string;
			customType?: string;
			details?: { delegationId?: string };
		};
		if (candidate.role !== "custom" || candidate.customType !== REALTIME_DELEGATION_MESSAGE_TYPE)
			return false;
		const id = candidate.details?.delegationId;
		if (!id) return false;
		const activate = this.pendingDelegations.get(id);
		if (!activate) return false;
		this.pendingDelegations.delete(id);
		activate();
		return true;
	}

	private appendMode(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
		if (mode === "realtime") {
			const message = codexVoiceModeMessage(mode, state);
			const delivery = {
				triggerTurn: false,
				deliverAs: "steer" as const,
			};
			if (!trySendCodexDeveloperCustomMessage(this.pi, message, delivery))
				this.pi.sendMessage(message, delivery);
			return;
		}
		this.pi.appendEntry<CodexVoiceModeMessageDetails>(
			CODEX_VOICE_MODE_MESSAGE_TYPE,
			{ mode, state },
		);
	}

	private replaceContext(ctx: ExtensionContext | undefined): void {
		this.pendingDelegations.clear();
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
		source: CodexRealtimeConversation | undefined,
	): Promise<void> {
		const ctx = this.context;
		if (generation !== this.contextGeneration || !turn.delegationId || !canDeliver) return;
		if (!ctx) {
			const error = "Voice request was not sent to Pi because the session is unavailable. Please try again.";
			this.pi.appendEntry<RealtimeVoiceMessageDetails>(
				REALTIME_DELEGATION_MESSAGE_TYPE,
				{ input: turn.input, route: "delegation", error },
			);
			this.callbacks.onDeliveryUnavailable(error);
			return;
		}
		const signal = this.delegationAbortController.signal;
		let deliveryStarted = false;
		try {
			for (;;) {
				const barrier = this.compactionBarrier?.promise ?? this.refreshBarriers.values().next().value;
				if (!barrier) break;
				if ((await interruptible(barrier, signal)) === CANCELLED)
					signal.throwIfAborted();
				if (
					generation !== this.contextGeneration ||
					this.context !== ctx
				) return;
			}
			signal.throwIfAborted();
			const admission = admitCustomTurn(this.pi, ctx);
			if (admission && (await interruptible(admission, signal)) === CANCELLED)
				signal.throwIfAborted();
			signal.throwIfAborted();
			if (generation !== this.contextGeneration || this.context !== ctx) return;
			deliveryStarted = true;
			const id = turn.delegationId;
			// Pi consumes queued steering at message_start, after the previous answer.
			this.pendingDelegations.set(id, () =>
				this.callbacks.onDelegation(id, turn.input, source),
			);
			this.piTurnActive = true;
			this.callbacks.onWorking();
			// Submission has no acceptance receipt. Do not retry a possibly delivered task.
			this.pi.sendMessage(
				{
					customType: REALTIME_DELEGATION_MESSAGE_TYPE,
					content: renderRealtimeUserInput(turn.input, turn.transcriptDelta),
					display: false,
					details: {
						input: turn.input,
						route: "delegation",
						delegationId: id,
					} satisfies RealtimeVoiceMessageDetails & { delegationId: string },
				},
				{ triggerTurn: true, deliverAs: "steer" },
			);
		} catch (error) {
			this.pendingDelegations.delete(turn.delegationId);
			if (
				generation !== this.contextGeneration ||
				this.context !== ctx
			) return;
			if (deliveryStarted) {
				try {
					this.piTurnActive = this.context ? !this.context.isIdle() : false;
				} catch {
					this.piTurnActive = false;
				}
				try { this.callbacks.onDelegationFailed(turn.delegationId); } catch {}
			}
			const message = signal.aborted
				? "Voice session stopped before the delegation was delivered"
				: error instanceof Error ? error.message : String(error);
			if (!signal.aborted) {
				try {
					ctx.ui.notify(
						`Could not deliver voice delegation: ${message}`,
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
			return;
		}
		this.pi.appendEntry<RealtimeVoiceMessageDetails>(
			REALTIME_DELEGATION_MESSAGE_TYPE,
			{ input: turn.input, route: "delegation" },
		);
	}
}
