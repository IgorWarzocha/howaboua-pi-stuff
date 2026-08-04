import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { RealtimeInitialMessageItem } from "../context.ts";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import { RealtimeVoiceTurnTracker, type RealtimeVoiceTurn } from "../turns.ts";
import { buildRealtimeCallRequest, type RealtimeCallSetup, setupRealtimeCall } from "./call-setup.ts";
import { RealtimeDelegationHandoff, type RealtimeHandoffChannel } from "./handoff.ts";
import { type CodexRealtimePeer, type CodexRealtimePeerEvent } from "./peer.ts";
import { boundedAssistantTranscript, boundedTranscript, realtimePeerStateFailure, remoteError, transcriptItemText } from "./wire.ts";

export { buildRealtimeCallRequest } from "./call-setup.ts";
export { utf8Chunks } from "./wire.ts";

const PEER_READY_TIMEOUT_MS = 15_000;

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
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
	private callSetup: RealtimeCallSetup = setupRealtimeCall;
	private inputMuted = false;

	constructor(callbacks: CodexConversationCallbacks, peer: CodexRealtimePeer) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.handoff = new RealtimeDelegationHandoff(peer, {
			isActive: () => this.state === "active",
			onFailure: (error) => this.fail(error),
			onSettled: (id) => this.turnTracker.delegationSettled(id),
			onStatus: (status) => this.callbacks.onStatus(status),
		});
		this.peer.onEvent((event) => this.handlePeerEvent(event));
		this.peer.onExit((error) => this.fail(error));
	}

	async start(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string, initialItems?: RealtimeInitialMessageItem[]): Promise<void> {
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

	finishAgentMessage(channel: RealtimeHandoffChannel): void {
		this.handoff.finishMessage(channel);
	}

	settleAgentTurn(): void {
		this.handoff.settle();
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
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
		if (event.type === "error") { this.fail(new Error(event.message)); return; }
		if (event.type === "data") this.handleServerEvent(event.message);
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private handleHelperState(state: string): void {
		const failure = realtimePeerStateFailure(state);
		if (failure) { this.fail(new Error(failure)); return; }
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
		this.callbacks.onTurn(delegated);
	}

	private handleCompletedTurn(turn: unknown): void {
		if (!turn || typeof turn !== "object") return;
		const record = turn as Record<string, unknown>;
		if (record["role"] === "user") {
			const input = boundedTranscript(record["transcript"]);
			if (input === "oversized") { this.fail(new Error("Codex voice transcript was oversized")); return; }
			if (input) this.callbacks.onUserTranscript(input);
			const delegated = input ? this.turnTracker.userFinished(input) : undefined;
			this.callbacks.onStatus("responding");
			if (delegated) {
				this.callbacks.onTurn(delegated);
			}
			return;
		}
		if (record["role"] !== "assistant") return;
		const completed = this.turnTracker.assistantFinished(boundedAssistantTranscript(record["transcript"]));
		this.callbacks.onStatus("listening");
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
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.abortSetup();
		this.handoff.clear();
		this.drainConversation();
		this.peerReady?.resolve();
		this.peerReady = undefined;
		this.callbacks.onError(error);
		void this.peer.close();
	}
}
