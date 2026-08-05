import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
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

export interface CodexVoiceSessionMessageCallbacks {
	canDelegate(): boolean;
	prepareDelegation(ctx: ExtensionContext): Promise<(() => boolean | void) | undefined>;
	onDelegation(id: string): void;
	onWorking(): void;
}

export class CodexVoiceSessionMessages {
	private readonly pi: ExtensionAPI;
	private readonly callbacks: CodexVoiceSessionMessageCallbacks;
	private context: ExtensionContext | undefined;
	private piTurnActive = false;
	private dictationAnnounced = false;
	private delegationTail: Promise<void> = Promise.resolve();
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
		const delivery = this.delegationTail.then(() =>
			this.deliverDelegation(turn, generation),
		);
		this.delegationTail = delivery.catch(() => undefined);
		return delivery;
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
		this.contextGeneration++;
		this.delegationTail = Promise.resolve();
		this.context = ctx;
	}

	private async deliverDelegation(
		turn: RealtimeVoiceTurn,
		generation: number,
	): Promise<void> {
		const ctx = this.context;
		if (
			generation !== this.contextGeneration ||
			!ctx ||
			!turn.delegationId ||
			!this.callbacks.canDelegate()
		) return;
		let startsTurn = !this.piTurnActive && ctx.isIdle();
		let commitPreflight: (() => boolean | void) | undefined;
		if (startsTurn) {
			for (;;) {
				try {
					commitPreflight = await this.callbacks.prepareDelegation(ctx);
				} catch (error) {
					if (
						generation === this.contextGeneration &&
						this.context === ctx
					) {
						const message = error instanceof Error ? error.message : String(error);
						ctx.ui.notify(`Could not prepare voice delegation: ${message}`, "error");
						this.pi.appendEntry<RealtimeVoiceMessageDetails>(
							REALTIME_DELEGATION_MESSAGE_TYPE,
							{ input: turn.input, route: "delegation", error: message },
						);
					}
					return;
				}
				if (
					generation !== this.contextGeneration ||
					this.context !== ctx ||
					!this.callbacks.canDelegate()
				) return;
				startsTurn = !this.piTurnActive && ctx.isIdle();
				if (!startsTurn || commitPreflight?.() !== false) break;
			}
		}
		this.callbacks.onDelegation(turn.delegationId);
		this.piTurnActive = true;
		this.callbacks.onWorking();
		this.pi.sendMessage(
			realtimeVoiceMessage(turn.input, "delegation", turn.transcriptDelta),
			startsTurn
				? { triggerTurn: true }
				: { triggerTurn: true, deliverAs: "steer" },
		);
	}
}
