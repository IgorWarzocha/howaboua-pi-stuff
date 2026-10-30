import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { GippityControlConfig } from "../../config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import { ConversationSetup } from "./connection.ts";
import type { PreparedVoiceTask } from "./end-call.ts";
import { type RealtimePiInputBehavior } from "./handoff.ts";
import type { CodexRealtimePeer, CodexRealtimePeerEvent } from "./peer.ts";
import { PublicRealtimeTurns } from "./public-turns.ts";
import { ConversationTurns } from "./turn-events.ts";
import { realtimePeerStateFailure } from "./wire.ts";

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
	onDrop(error: Error): void;
	onStatus(status: string): void;
	onTurn(turn: RealtimeVoiceTurn): void;
	rewriteDelegation?(
		turn: RealtimeVoiceTurn,
		signal: AbortSignal,
	): Promise<PreparedVoiceTask>;
	onEndCall?(finalOutputObserved?: boolean, resultDelegationId?: string): void;
	onDelegationError?(error: Error): void;
	onUserTranscript(transcript: string): void;
	onTranscriptTail(transcriptDelta: string): void;
}

export class CodexRealtimeConversation {
	private readonly callbacks: CodexConversationCallbacks;
	private readonly setup: ConversationSetup;
	private readonly peer: CodexRealtimePeer;
	private readonly turns: ConversationTurns | PublicRealtimeTurns;
	private state: ConversationState = "idle";
	private closePromise: Promise<void> | undefined;
	private inputMuted = false;
	finishingAcceptedWork = false;
	private ending = false;
	private endAfterResult: { id: string; active: boolean } | undefined;
	private completedOutputs = 0;
	private endingOutput = 0;
	private readonly closing = new AbortController();
	private established = false;

	constructor(
		callbacks: CodexConversationCallbacks,
		peer: CodexRealtimePeer,
		publicRealtime = false,
	) {
		this.callbacks = callbacks;
		this.peer = peer;
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
		const Turns = publicRealtime ? PublicRealtimeTurns : ConversationTurns;
		this.turns = new Turns(
			{
				...callbacks,
				onEndCall: (finalOutputObserved = false, resultDelegationId) => {
					if (resultDelegationId) {
						this.endAfterResult = { id: resultDelegationId, active: false };
						this.turns.sendContext(
							{ type: "session" },
							"commentary",
							"The user wants the requested answer before ending the call. When its result arrives, speak the answer and a brief farewell.",
						);
					} else this.beginEnding(finalOutputObserved);
				},
			},
			peer,
			() => this.state === "active",
			(error) => this.fail(error),
		);
		this.peer.onEvent((event) => this.handlePeerEvent(event));
		this.peer.onExit((error) => this.drop(error));
	}

	start(
		auth: CodexVoiceAuth,
		config: GippityControlConfig,
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
		this.appendSpeakableContext(
			arrival
				? "The user has just arrived from another session by voice. Give a short, distinctive arrival greeting that makes the switch clear and naturally acknowledges this session's topic or state. Do not repeat the continuity summary or start a task. Then wait for them to speak."
				: contextual
					? "The voice session has started with context from the ongoing conversation. Greet the user by naturally acknowledging the relevant topic, state, or next step. Do not give a generic hello or repeat the context summary. Then wait for them to speak."
					: "The voice session has started. Give the user a short, distinctive greeting with some personality; a bare generic hello is not enough. Then wait for them to speak.",
		);
	}

	announcePrompt(prompt: string): void {
		if (this.state !== "active") return;
		this.appendSpeakableContext(prompt);
	}

	announceCompactionStart(reason: "threshold" | "overflow"): void {
		if (this.state !== "active") return;
		const prompt =
			reason === "overflow"
				? "The conversation exceeded its context limit and is being compacted. The interrupted work will continue automatically afterward. Please announce this briefly in your natural voice."
				: "The conversation is being compacted. Please announce this briefly in your natural voice.";
		this.appendSpeakableContext(prompt);
	}

	private appendSpeakableContext(text: string): void {
		this.turns.sendContext({ type: "session" }, "speakable", text);
	}

	activateDelegation(id: string): void {
		if (this.endAfterResult?.active && this.endAfterResult.id !== id)
			this.endAfterResult = undefined;
		this.turns.handoff.activate(id);
		if (this.endAfterResult?.id === id) this.endAfterResult.active = true;
	}

	piInput(
		input: unknown,
		streamingBehavior?: RealtimePiInputBehavior,
	): boolean {
		const routed = this.turns.handoff.piInput(input, streamingBehavior);
		if (routed && streamingBehavior === undefined)
			this.endAfterResult = undefined;
		return routed;
	}

	piUserMessage(message: unknown): boolean {
		const consumed = this.turns.handoff.piUserMessage(message);
		if (consumed) this.endAfterResult = undefined;
		return consumed;
	}

	get microphoneMuted(): boolean {
		return this.inputMuted;
	}

	setInputMuted(muted: boolean): void {
		if (this.state !== "active" || this.inputMuted === muted) return;
		this.peer.setInputMuted(muted);
		this.inputMuted = muted;
	}

	streamAgentDelta(delta: string): void {
		if (this.ending) return;
		this.turns.handoff.stream(delta);
	}

	resumeAgentWork(): void {
		if (this.ending) return;
		this.turns.handoff.flushProgress();
	}

	agentProgress(content: string, reasoningSummary?: string): void {
		if (this.ending) return;
		this.turns.handoff.progress(content, reasoningSummary);
	}

	agentResult(
		content: string,
		stopReason: AssistantMessage["stopReason"],
	): void {
		if (this.ending) return;
		if (stopReason !== "stop") {
			this.turns.handoff.progress(content);
			this.failDeferredEnding();
			return;
		}
		this.turns.handoff.result(content);
		if (this.endAfterResult?.active && content.trim()) this.beginEnding(false);
	}

	settleAgentTurn(): void {
		this.failDeferredEnding();
		if (this.ending) {
			this.turns.handoff.clear();
			return;
		}
		this.turns.handoff.settle();
		if (!this.turns.speakableResponsePending)
			this.callbacks.onStatus("listening");
	}

	private failDeferredEnding(): void {
		if (this.endAfterResult?.active) {
			this.endAfterResult = undefined;
			this.appendSpeakableContext(
				"The requested answer did not complete. Tell the user it could not be finished and the call remains open; they can retry or stop the call.",
			);
		}
	}

	private beginEnding(finalOutputObserved: boolean): void {
		if (this.ending) return;
		this.endAfterResult = undefined;
		this.ending = true;
		this.endingOutput = this.completedOutputs + (finalOutputObserved ? 0 : 1);
		this.turns.handoff.clear();
		this.callbacks.onEndCall?.();
	}

	get isEndingCall(): boolean {
		return this.ending;
	}

	/** Require the closing response observed since delegation, not an initially idle call. */
	waitForFinalPlayback(): Promise<void> {
		return this.waitForPlaybackEnd(this.closing.signal, this.endingOutput);
	}

	/** Quiet peer activity is best-effort: the helper has no speaker-drain acknowledgement. */
	waitForPlaybackEnd(signal: AbortSignal, minimumOutputs = 0): Promise<void> {
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			let quiet: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: Error) => {
				clearTimeout(timeout);
				clearTimeout(quiet);
				removeEvent();
				removeExit();
				signal.removeEventListener("abort", aborted);
				if (error) reject(error);
				else resolve();
			};
			const check = () => {
				clearTimeout(quiet);
				if (minimumOutputs && !this.ending) {
					finish(new Error("Call ending interrupted by new speech"));
					return;
				}
				if (this.state !== "active") {
					finish(new Error("The voice call closed before playback finished"));
					return;
				}
				if (
					this.completedOutputs >= minimumOutputs &&
					!this.turns.speakableResponsePending
				)
					quiet = setTimeout(() => finish(), 500);
			};
			const aborted = () => finish(new Error("Playback wait cancelled"));
			const timeout = setTimeout(
				() =>
					finish(new Error("Voice output did not finish within 30 seconds")),
				30_000,
			);
			const removeEvent = this.peer.onEvent(check);
			const removeExit = this.peer.onExit(finish);
			signal.addEventListener("abort", aborted, { once: true });
			check();
		});
	}

	async close(finishAcceptedWork = false): Promise<void> {
		this.finishingAcceptedWork ||= finishAcceptedWork;
		this.closePromise ??= this.closeSession();
		return this.closePromise;
	}

	async waitForDelegations(signal: AbortSignal): Promise<void> {
		if (this.turns instanceof ConversationTurns)
			await this.turns.waitForDelegations(signal);
	}

	private async closeSession(): Promise<void> {
		this.closing.abort();
		this.state = "closed";
		this.established = false;
		this.turns.speakableResponsePending = false;
		this.setup.abort();
		this.turns.handoff.clear();
		if (!this.finishingAcceptedWork) this.turns.drainConversation();
		this.inputMuted = false;
		this.setup.finish();
		const accepted =
			this.finishingAcceptedWork && this.turns instanceof ConversationTurns
				? this.turns.finishDelegations()
				: undefined;
		await this.peer.close();
		if (this.finishingAcceptedWork) {
			await accepted;
			this.turns.drainConversation();
		}
	}

	private handlePeerEvent(event: CodexRealtimePeerEvent): void {
		if (
			this.state === "idle" ||
			this.state === "closed" ||
			this.state === "failed"
		)
			return;
		if (event.type === "error") {
			const error = new Error(event.message);
			if (terminalTransportError(event.message)) this.drop(error);
			else this.fail(error);
			return;
		}
		if (event.type === "playback_activity") {
			if (this.turns instanceof PublicRealtimeTurns) this.turns.audioActivity();
			else this.turns.playback.audioActivity();
		}
		if (event.type === "data") {
			if (!event.message || typeof event.message !== "object") return;
			const message = event.message as {
				type?: string;
				turn?: { role?: string };
				response?: { status?: string };
			};
			if (
				message.type === "input_audio_buffer.speech_started" ||
				(message.type === "turn.created" && message.turn?.role === "user") ||
				(message.type === "response.done" &&
					message.response?.status === "cancelled")
			) {
				this.ending = false;
				this.endAfterResult = undefined;
				if (this.turns instanceof PublicRealtimeTurns)
					this.turns.cancelEndCall();
			}
			if (
				(message.type === "turn.done" && message.turn?.role === "assistant") ||
				(message.type === "response.done" &&
					message.response?.status === "completed")
			)
				this.completedOutputs++;
			this.turns.receive(event.message);
		}
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private handleHelperState(state: string): void {
		const failure = realtimePeerStateFailure(state);
		if (failure) {
			this.drop(new Error(failure));
			return;
		}
		if (state === "ready" || state === "listening") {
			this.setup.ready();
			this.callbacks.onStatus("listening");
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
		void this.close();
	}
}

function terminalTransportError(message: string): boolean {
	return (
		message === "DataChannel is not opened" ||
		message.startsWith("realtime speaker stream ended:") ||
		message.startsWith("realtime microphone stream failed:")
	);
}
