import { ConversationSetup } from "./connection.ts";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import { CANCELLED, interruptible } from "../cancellation.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import type { RealtimePiInputBehavior } from "./handoff.ts";
import type { CodexRealtimePeer, CodexRealtimePeerEvent } from "./peer.ts";
import { ConversationTurns } from "./turn-events.ts";
import {
	type RealtimeVoiceEventDetails,
	realtimePeerStateFailure,
} from "./wire.ts";

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
	onDrop(error: Error): void;
	onStatus(status: string): void;
	onTurn(turn: RealtimeVoiceTurn): void;
	onUserTranscript(transcript: string): void;
	onTranscriptTail(transcriptDelta: string): void;
	onEvent?(event: RealtimeVoiceEventDetails): void;
}

export class CodexRealtimeConversation {
	private readonly callbacks: CodexConversationCallbacks;
	private readonly setup: ConversationSetup;
	private readonly peer: CodexRealtimePeer;
	private readonly turns: ConversationTurns;
	private state: ConversationState = "idle";
	private closePromise: Promise<void> | undefined;
	private inputMuted = false;
	private established = false;
	private inputChanged = Promise.withResolvers<void>();

	constructor(callbacks: CodexConversationCallbacks, peer: CodexRealtimePeer) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.setup = new ConversationSetup(
			peer,
			() => this.state === "starting",
			(muted) => {
				this.state = "active";
				if (muted) this.setInputMuted(true);
			},
			(status) => this.callbacks.onStatus(status),
		);
		this.turns = new ConversationTurns(
			callbacks,
			peer,
			() => this.state === "active",
			(error) => this.fail(error),
		);
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

	announceContextTransition(
		reason: "threshold" | "overflow" | "rollover",
	): void {
		if (this.state !== "active") return;
		const prompt =
			reason === "rollover"
				? "I'm moving to a fresh context window and carrying our conversation forward. Briefly acknowledge this in your natural voice."
				: reason === "overflow"
					? "The conversation exceeded its context limit and is being compacted. The interrupted work will continue automatically afterward. Please announce this briefly in your natural voice."
					: "The conversation is being compacted. Please announce this briefly in your natural voice.";
		this.appendSpeakableContext(prompt);
	}

	private appendSpeakableContext(text: string): void {
		this.turns.sendContext({ type: "session" }, "speakable", text);
	}

	activateDelegation(id: string): void {
		this.turns.handoff.activate(id);
	}

	agentStarted(): void {
		this.turns.handoff.agentStarted();
	}

	piInput(
		input: unknown,
		streamingBehavior?: RealtimePiInputBehavior,
	): boolean {
		return this.turns.handoff.piInput(input, streamingBehavior);
	}

	piUserMessage(message: unknown): boolean {
		return this.turns.handoff.piUserMessage(message);
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
		this.turns.handoff.stream(delta);
	}

	resumeAgentWork(): void {
		this.turns.handoff.flushProgress();
	}

	agentProgress(content: string): void {
		this.turns.handoff.progress(content);
	}

	agentResult(content: string): void {
		this.turns.handoff.result(content);
	}

	settleAgentTurn(): void {
		this.turns.handoff.settle();
		if (!this.turns.speakableResponsePending)
			this.callbacks.onStatus("listening");
	}

	/** Used only after the transferring Pi turn settles; never gates ordinary speech. */
	waitForPlaybackEnd(signal: AbortSignal): Promise<void> {
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
				if (this.state !== "active") {
					finish(new Error("The source voice call ended before transfer"));
					return;
				}
				if (!this.turns.speakableResponsePending)
					quiet = setTimeout(() => finish(), 500);
			};
			const aborted = () => finish(new Error("Voice transfer cancelled"));
			const timeout = setTimeout(
				() => finish(new Error("Source speech did not finish before transfer")),
				30_000,
			);
			const removeEvent = this.peer.onEvent(check);
			const removeExit = this.peer.onExit(finish);
			signal.addEventListener("abort", aborted, { once: true });
			check();
		});
	}

	async close(): Promise<void> {
		this.closePromise ??= this.closeSession();
		return this.closePromise;
	}

	async waitForInput(signal: AbortSignal): Promise<void> {
		while (this.state === "active" && this.turns.hasPendingInput) {
			if (
				(await interruptible(this.inputChanged.promise, signal)) === CANCELLED
			)
				signal.throwIfAborted();
		}
	}

	private async closeSession(): Promise<void> {
		this.state = "closed";
		this.established = false;
		this.turns.speakableResponsePending = false;
		this.setup.abort();
		this.turns.handoff.clear();
		this.turns.drainConversation();
		this.inputChanged.resolve();
		this.inputMuted = false;
		this.setup.finish();
		await this.peer.close();
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
		if (event.type === "playback_activity") this.turns.playback.audioActivity();
		if (event.type === "data") {
			this.turns.receive(event.message);
			this.inputChanged.resolve();
			this.inputChanged = Promise.withResolvers<void>();
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
