import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import { RealtimeVoiceTurnTracker, type RealtimeVoiceTurn } from "../turns.ts";
import { buildRealtimeCallRequest, type RealtimeCallSetup, setupRealtimeCall } from "./call-setup.ts";
import { RealtimeDelegationHandoff, type RealtimeHandoffChannel } from "./handoff.ts";
import { type CodexRealtimePeer, type CodexRealtimePeerEvent } from "./peer.ts";
import { boundedAssistantTranscript, boundedTranscript, realtimePeerStateFailure, remoteError, transcriptItemText, utf8Chunks } from "./wire.ts";

const PEER_READY_TIMEOUT_MS = 15_000;
const CONTEXT_APPEND_CHUNK_BYTES = 500;
type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
	onDrop(error: Error): void;
	onStatus(status: string): void;
	onTurn(turn: RealtimeVoiceTurn): void;
	onUserTranscript(transcript: string): void;
	onTranscriptTail(transcriptDelta: string): void;
}

export class CodexRealtimeConversation {
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly turnTracker = new RealtimeVoiceTurnTracker();
	private readonly handoff: RealtimeDelegationHandoff;
	private state: ConversationState = "idle";
	private setupAbortController: AbortController | undefined;
	private peerReady: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private closePromise: Promise<void> | undefined;
	private callSetup: RealtimeCallSetup = setupRealtimeCall;
	private inputMuted = false;
	private established = false;
	private speakableResponsePending = false;
	private pendingCompactionAnnouncement: string | undefined;

	constructor(callbacks: CodexConversationCallbacks, peer: CodexRealtimePeer) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.handoff = new RealtimeDelegationHandoff(peer, {
			isActive: () => this.state === "active",
			onFailure: (error) => this.fail(error),
			onSettled: (id) => this.turnTracker.delegationSettled(id),
			onStatus: (status) => {
				if (status === "speaking") this.speakableResponsePending = true;
				this.callbacks.onStatus(status);
			},
		});
		this.peer.onEvent((event) => this.handlePeerEvent(event));
		this.peer.onExit((error) => this.drop(error));
	}

	async start(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string, initialItems?: RealtimeInitialMessageItem[], inputMuted = false): Promise<void> {
		this.state = "starting";
		const sdp = await this.peer.start(config);
		if (this.state !== "starting") return;
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		headers.set("content-type", "application/json");
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls?intent=quicksilver&architecture=avas`;
		const setupAbortController = new AbortController();
		this.setupAbortController = setupAbortController;
		const requestBody = JSON.stringify(buildRealtimeCallRequest(sdp, config, instructions, initialItems));
		let status: number;
		let answer: string;
		try {
			({ status, answer } = await this.callSetup(
				endpoint,
				headers,
				setupAbortController.signal,
				requestBody,
				auth.env,
			));
		} finally {
			if (this.setupAbortController === setupAbortController) this.setupAbortController = undefined;
		}
		if (this.state !== "starting") return;
		if (status !== 201) throw new Error(`Codex voice call failed (${status}): ${answer.slice(0, 1_000)}`);
		this.state = "active";
		if (inputMuted) this.setInputMuted(true);
		const peerReady = Promise.withResolvers<void>();
		this.peerReady = peerReady;
		this.callbacks.onStatus("connecting…");
		this.peer.applyAnswer(answer);
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				peerReady.promise,
				new Promise<void>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error("Codex voice peer did not become ready")), PEER_READY_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.peerReady === peerReady) this.peerReady = undefined;
		}
	}

	markEstablished(): void {
		if (this.state === "active") this.established = true;
	}

	greet(contextual: boolean): void {
		if (this.state !== "active") return;
		this.appendSpeakableContext(
			contextual
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
		if (this.speakableResponsePending) {
			this.pendingCompactionAnnouncement = prompt;
			return;
		}
		this.appendSpeakableContext(prompt);
	}

	private appendSpeakableContext(text: string): void {
		try {
			this.speakableResponsePending = true;
			for (const content of utf8Chunks(text, CONTEXT_APPEND_CHUNK_BYTES))
				this.peer.sendData({
					type: "session.context.append",
					channel: "speakable",
					content: [{ type: "input_text", text: content }],
				});
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	activateDelegation(id: string): void {
		this.handoff.activate(id);
	}

	get microphoneMuted(): boolean { return this.inputMuted; }

	setInputMuted(muted: boolean): void {
		if (this.state !== "active" || this.inputMuted === muted) return;
		this.peer.setInputMuted(muted);
		this.inputMuted = muted;
	}

	mirrorPiSteer(input: unknown): boolean {
		return this.handoff.mirrorPiSteer(input);
	}

	streamAgentDelta(delta: string): void {
		this.handoff.stream(delta);
	}

	finishAgentMessage(channel: RealtimeHandoffChannel, fallback?: string): void {
		this.handoff.finishMessage(channel, fallback);
	}

	finishAgentProgress(fallback?: string): void {
		this.handoff.finishProgress(fallback);
	}

	get agentProgressStreamed(): boolean {
		return this.handoff.hasStreamedProgress();
	}

	settleAgentTurn(): void {
		this.handoff.settle();
	}

	async close(): Promise<void> {
		this.closePromise ??= this.closeSession();
		return this.closePromise;
	}

	private async closeSession(): Promise<void> {
		this.state = "closed";
		this.established = false;
		this.abortSetup();
		this.handoff.clear();
		this.drainConversation();
		this.inputMuted = false;
		this.peerReady?.resolve();
		this.peerReady = undefined;
		await this.peer.close();
	}

	private handlePeerEvent(event: CodexRealtimePeerEvent): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		if (event.type === "error") {
			const error = new Error(event.message);
			if (terminalTransportError(event.message)) this.drop(error);
			else this.fail(error);
			return;
		}
		if (event.type === "data") this.handleServerEvent(event.message);
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private handleHelperState(state: string): void {
		const failure = realtimePeerStateFailure(state);
		if (failure) { this.drop(new Error(failure)); return; }
		if (state === "ready" || state === "listening") {
			this.peerReady?.resolve();
			this.callbacks.onStatus("listening");
		}
		else if (state === "connecting" || state === "connected") this.callbacks.onStatus("connecting…");
		else if (state === "disconnected") this.callbacks.onStatus("reconnecting…");
	}

	private handleServerEvent(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const event = value as Record<string, unknown>;
		if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
		if (event["type"] === "input_transcript.added") {
			const input = boundedTranscript(transcriptItemText(event["item"]));
			if (input === "oversized") { this.fail(new Error("Codex voice transcript was oversized")); return; }
			if (input) this.turnTracker.inputAdded(input);
			return;
		}
		if (event["type"] === "output_transcript.added") {
			const output = boundedAssistantTranscript(transcriptItemText(event["item"]));
			if (output) this.turnTracker.outputAdded(output);
			this.callbacks.onStatus("speaking");
			return;
		}
		if (event["type"] === "turn.done") {
			this.handleCompletedTurn(event["turn"]);
			return;
		}
		if (event["type"] !== "delegation.created" || this.state !== "active") return;
		const item = event["item"];
		if (!item || typeof item !== "object") return;
		const record = item as Record<string, unknown>;
		if (record["type"] !== "delegation" || record["target"] !== "client" || typeof record["id"] !== "string" || !Array.isArray(record["content"])) return;
		const input = record["content"].flatMap((part) => part && typeof part === "object" && (part as Record<string, unknown>)["type"] === "input_text" && typeof (part as Record<string, unknown>)["text"] === "string" ? [(part as Record<string, unknown>)["text"] as string] : []).join("").trim();
		if (!input || Buffer.byteLength(input) > MAX_REALTIME_VOICE_INPUT_BYTES) { this.fail(new Error("Codex voice delegation was empty or oversized")); return; }
		const delegated = this.turnTracker.delegated(input, record["id"]);
		if (!delegated) return;
		if (delegated.displayInput) this.callbacks.onUserTranscript(input);
		this.callbacks.onTurn(delegated.turn);
	}

	private handleCompletedTurn(turn: unknown): void {
		if (!turn || typeof turn !== "object") return;
		const record = turn as Record<string, unknown>;
		if (record["role"] === "user") {
			const input = boundedTranscript(record["transcript"]);
			if (input === "oversized") { this.fail(new Error("Codex voice transcript was oversized")); return; }
			if (input && this.turnTracker.userFinished(input))
				this.callbacks.onUserTranscript(input);
			this.callbacks.onStatus("responding");
			return;
		}
		if (record["role"] !== "assistant") return;
		const completed = this.turnTracker.assistantFinished(boundedAssistantTranscript(record["transcript"]));
		this.speakableResponsePending = false;
		const pendingCompaction = this.pendingCompactionAnnouncement;
		this.pendingCompactionAnnouncement = undefined;
		if (pendingCompaction) this.appendSpeakableContext(pendingCompaction);
		else this.callbacks.onStatus("listening");
		if (completed) this.callbacks.onTurn(completed);
	}

	private abortSetup(): void {
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
	}

	private drainConversation(): void {
		for (const turn of this.turnTracker.drainConversationTurns()) this.callbacks.onTurn(turn);
		const transcriptTail = this.turnTracker.takeTranscriptTail();
		if (transcriptTail) this.callbacks.onTranscriptTail(transcriptTail);
		this.turnTracker.reset();
	}

	private fail(error: Error): void {
		this.finishFailure(error, false);
	}

	private drop(error: Error): void {
		this.finishFailure(error, this.established);
	}

	private finishFailure(error: Error, dropped: boolean): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.established = false;
		this.abortSetup();
		this.handoff.clear();
		this.drainConversation();
		this.peerReady?.resolve();
		this.peerReady = undefined;
		if (dropped) this.callbacks.onDrop(error);
		else this.callbacks.onError(error);
		void this.close();
	}
}

function terminalTransportError(message: string): boolean {
	return message === "DataChannel is not opened"
		|| message.startsWith("realtime speaker stream ended:")
		|| message.startsWith("realtime microphone stream failed:");
}
