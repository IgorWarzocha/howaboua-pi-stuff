import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { VoiceAudioDiagnostics } from "../helper-protocol.ts";
import { CANCELLED, interruptible } from "../cancellation.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import { realtimeContextTransition, realtimeGreeting } from "../prompts.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import { ConversationSetup } from "./connection.ts";
import { ConversationAgentTurn } from "./agent-turn.ts";
import { ApiLiveSessionHandshake } from "./api-live-session-handshake.ts";
import { ApiLiveTurns } from "./api-live-turns.ts";
import type { RealtimePeer, RealtimePeerEvent } from "./peer.ts";
import { PlaybackSettlement } from "./playback-settlement.ts";
import { PublicRealtimeTurns } from "./public-turns.ts";
import { ConversationTurns } from "./turn-events.ts";
import {
	type RealtimeVoiceEventDetails,
	realtimeCallSignal,
	realtimePeerStateFailure,
	terminalRealtimeTransportError,
} from "./wire.ts";

import type { PreparedVoiceTask } from "./end-call.ts";

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface ConversationCallbacks {
	onError(error: Error): void;
	onDrop(error: Error): void;
	onStatus(status: string): void;
	onAudioDiagnostics?(diagnostics: VoiceAudioDiagnostics): void;
	onTurn(turn: RealtimeVoiceTurn): void;
	rewriteDelegation?(
		turn: RealtimeVoiceTurn,
		signal: AbortSignal,
	): Promise<PreparedVoiceTask>;
	onEndCall?(finalOutputObserved?: boolean, resultDelegationId?: string): void;
	onDelegationError?(error: Error): void;
	onUserTranscript(transcript: string): void;
	onTranscriptTail(transcriptDelta: string): void;
	onEvent?(event: RealtimeVoiceEventDetails): void;
}

export class RealtimeConversation {
	readonly agentTurn: ConversationAgentTurn;
	private readonly callbacks: ConversationCallbacks;
	private readonly setup: ConversationSetup;
	private readonly peer: RealtimePeer;
	private readonly turns:
		| ConversationTurns
		| PublicRealtimeTurns
		| ApiLiveTurns;
	private readonly apiLive: ApiLiveSessionHandshake | undefined;
	private readonly playback: PlaybackSettlement;
	private state: ConversationState = "idle";
	private closePromise: Promise<void> | undefined;
	private inputMuted = false;
	finishingAcceptedWork = false;
	private readonly closing = new AbortController();
	private established = false;
	private inputChanged = Promise.withResolvers<void>();

	constructor(
		callbacks: ConversationCallbacks,
		peer: RealtimePeer,
		protocol: "codex" | "realtime" | "api-live" = "codex",
	) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.apiLive =
			protocol === "api-live" ? new ApiLiveSessionHandshake(peer) : undefined;
		this.setup = new ConversationSetup(
			peer,
			() => this.state === "starting",
			() => this.state === "active",
			(muted) => {
				this.state = "active";
				if (muted) this.setInputMuted(true);
			},
			(status) => this.callbacks.onStatus(status),
		);
		const turnCallbacks: ConversationCallbacks = {
			...callbacks,
			onEndCall: (finalOutputObserved, resultDelegationId) =>
				this.agentTurn.requestEnd(finalOutputObserved, resultDelegationId),
		};
		const active = () => this.state === "active";
		const fail = (error: Error) => this.fail(error);
		this.playback = new PlaybackSettlement(peer, {
			isActive: active,
			isEnding: () => this.agentTurn.isEnding,
			hasPendingOutput: (includeQueuedResponse) =>
				this.turns.speakableResponsePending ||
				(includeQueuedResponse &&
					this.turns instanceof PublicRealtimeTurns &&
					this.turns.hasQueuedResponse),
		});
		const checkPlayback = () => this.playback.recheck();
		this.turns =
			protocol === "api-live"
				? new ApiLiveTurns(turnCallbacks, peer, active, fail, {
						onInputStarted: () => {
							this.agentTurn.interruptEnding();
							checkPlayback();
						},
						onInputChanged: () => this.noteInputChanged(),
						onOutputFinished: () => {
							this.playback.recordOutputFinished();
							checkPlayback();
						},
						onOutputChanged: checkPlayback,
					})
				: protocol === "realtime"
					? new PublicRealtimeTurns(
							turnCallbacks,
							peer,
							active,
							fail,
							checkPlayback,
						)
					: new ConversationTurns(turnCallbacks, peer, active, fail);
		this.agentTurn = new ConversationAgentTurn(this.turns.handoff, {
			sendContext: (channel, text) =>
				this.turns.sendContext({ type: "session" }, channel, text),
			completedOutputs: () => this.playback.completedOutputs,
			hasPendingOutput: () => this.turns.speakableResponsePending,
			onListening: () => this.callbacks.onStatus("listening"),
			onEndCall: () => this.callbacks.onEndCall?.(),
		});
		this.peer.onEvent((event) => this.handlePeerEvent(event));
		this.peer.onExit((error) => this.drop(error));
	}

	start(
		auth: CodexVoiceAuth,
		config: CodexConversionConfig,
		instructions: string,
		initialItems?: RealtimeInitialMessageItem[],
		inputMuted = false,
	): Promise<void> {
		this.state = "starting";
		if (this.turns instanceof PublicRealtimeTurns) {
			if (!auth.realtime)
				throw new Error(
					"Realtime API credentials are unavailable; restart voice",
				);
			this.turns.configure(auth.realtime);
		}
		return this.setup.start(
			auth,
			config,
			instructions,
			initialItems,
			inputMuted,
		);
	}

	markEstablished(): void {
		if (this.state === "active") this.established = true;
	}

	greet(contextual: boolean, arrival = false): void {
		if (this.state !== "active") return;
		this.appendVoiceInstruction(realtimeGreeting(contextual, arrival));
	}

	announcePrompt(prompt: string): void {
		if (this.state !== "active") return;
		this.appendSpeakableContext(prompt);
	}

	announceContextTransition(
		reason: "threshold" | "overflow" | "rollover",
	): void {
		if (this.state !== "active") return;
		this.appendVoiceInstruction(realtimeContextTransition(reason));
	}

	private appendVoiceInstruction(text: string): void {
		if (this.turns instanceof ApiLiveTurns) this.turns.sendInstructions(text);
		else this.appendSpeakableContext(text);
	}

	private appendSpeakableContext(text: string): void {
		this.turns.sendContext({ type: "session" }, "speakable", text);
	}

	get microphoneMuted(): boolean {
		return this.inputMuted;
	}

	setInputMuted(muted: boolean): void {
		if (this.state !== "active" || this.inputMuted === muted) return;
		this.peer.setInputMuted(muted);
		this.inputMuted = muted;
	}

	get isEndingCall(): boolean {
		return this.agentTurn.isEnding;
	}

	get playbackSealed(): boolean {
		return this.peer.playbackSealed === true;
	}

	/** Require the closing response observed since delegation, not an initially idle call. */
	async waitForFinalPlayback(): Promise<void> {
		await this.waitForPlaybackEnd(this.closing.signal, {
			minimumOutputs: this.agentTurn.finalOutputTarget,
		});
		if (!this.agentTurn.isEnding)
			throw new Error("Call ending interrupted by new speech");
		await this.apiLive?.finalize();
		await this.peer.finishPlayback?.(this.closing.signal);
	}

	waitForPlaybackEnd(
		...args: Parameters<PlaybackSettlement["waitForEnd"]>
	): Promise<void> {
		return this.playback.waitForEnd(...args);
	}

	async close(finishAcceptedWork = false): Promise<void> {
		this.finishingAcceptedWork ||= finishAcceptedWork;
		this.closePromise ??= this.closeSession();
		return this.closePromise;
	}

	waitForRefreshBoundary(signal: AbortSignal): Promise<void> {
		return this.playback.waitForRefresh(signal, {
			nextChange: () => this.inputChanged.promise,
			waitUntilSettled: (currentSignal) => this.waitForInput(currentSignal),
		});
	}

	private async waitForInput(signal: AbortSignal): Promise<void> {
		do {
			while (this.state === "active" && this.turns.hasPendingInput) {
				if (
					(await interruptible(this.inputChanged.promise, signal)) === CANCELLED
				)
					signal.throwIfAborted();
			}
			if (
				this.turns instanceof ConversationTurns ||
				this.turns instanceof ApiLiveTurns
			)
				await this.turns.waitForDelegations(signal);
		} while (this.state === "active" && this.turns.hasPendingInput);
	}

	private async closeSession(): Promise<void> {
		this.closing.abort();
		this.state = "closed";
		this.established = false;
		this.turns.speakableResponsePending = false;
		this.setup.abort();
		this.turns.handoff.clear();
		if (!this.finishingAcceptedWork) this.turns.drainConversation();
		this.inputChanged.resolve();
		this.inputMuted = false;
		this.setup.finish();
		const accepted =
			this.finishingAcceptedWork &&
			(this.turns instanceof ConversationTurns ||
				this.turns instanceof ApiLiveTurns)
				? this.turns.finishDelegations()
				: undefined;
		await this.apiLive?.finalize();
		await this.peer.close();
		if (this.finishingAcceptedWork) {
			await accepted;
			this.turns.drainConversation();
		}
		this.apiLive?.throwIfFailed();
	}

	private handlePeerEvent(event: RealtimePeerEvent): void {
		if (
			this.state === "idle" ||
			this.state === "closed" ||
			this.state === "failed"
		)
			return;
		if (event.type === "error") {
			const error = new Error(event.message);
			if (terminalRealtimeTransportError(event.message)) this.drop(error);
			else this.fail(error);
			return;
		}
		if (event.type === "playback_activity") {
			if (
				this.turns instanceof PublicRealtimeTurns ||
				this.turns instanceof ApiLiveTurns
			)
				this.turns.audioActivity();
			else this.turns.playback.audioActivity();
		}
		if (event.type === "audio_diagnostics")
			this.callbacks.onAudioDiagnostics?.(event.diagnostics);
		if (event.type === "data") {
			if (!event.message || typeof event.message !== "object") return;
			const signal = realtimeCallSignal(event.message);
			if (this.apiLive && signal === "api-started") {
				this.apiLive.markStarted();
				this.setup.ready();
				this.callbacks.onStatus("listening");
			}
			if (this.apiLive && signal === "api-closed") {
				if (this.apiLive.markClosed())
					this.drop(new Error("The voice session ended. Start voice again."));
				return;
			}
			if (signal === "interrupt") {
				this.agentTurn.interruptEnding();
				if (this.turns instanceof PublicRealtimeTurns)
					this.turns.cancelEndCall();
			}
			if (signal === "output-finished") this.playback.recordOutputFinished();
			this.turns.receive(event.message);
			this.noteInputChanged();
		}
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private noteInputChanged(): void {
		this.inputChanged.resolve();
		this.inputChanged = Promise.withResolvers<void>();
	}

	private handleHelperState(state: string): void {
		const failure = realtimePeerStateFailure(state);
		if (failure) {
			this.drop(new Error(failure));
			return;
		}
		if (state === "ready" || state === "listening") {
			if (!this.apiLive) {
				this.setup.ready();
				this.callbacks.onStatus("listening");
			}
		} else if (state === "connecting" || state === "connected")
			this.callbacks.onStatus("connecting…");
		else if (state === "disconnected") this.callbacks.onStatus("reconnecting…");
	}

	private fail(error: Error): void {
		this.finishFailure(error, false);
	}

	private drop(error: Error): void {
		this.finishFailure(error, this.established);
	}

	private finishFailure(error: Error, dropped: boolean): void {
		if (
			this.state === "idle" ||
			this.state === "closed" ||
			this.state === "failed"
		)
			return;
		this.state = "failed";
		this.established = false;
		this.turns.speakableResponsePending = false;
		this.setup.abort();
		this.turns.handoff.clear();
		this.turns.drainConversation();
		this.setup.finish();
		if (dropped) this.callbacks.onDrop(error);
		else this.callbacks.onError(error);
		void this.close().catch((failure: unknown) => {
			const error =
				failure instanceof Error ? failure : new Error(String(failure));
			if (this.callbacks.onDelegationError)
				this.callbacks.onDelegationError(error);
			else this.callbacks.onError(error);
		});
	}
}
