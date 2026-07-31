import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { resolveWebSocketProxyForTarget } from "../../providers/openai-codex/websocket-connection.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import { MAX_REALTIME_VOICE_INPUT_BYTES, renderPiSteer } from "../prompts.ts";
import { RealtimeVoiceTurnTracker, type RealtimeVoiceTurn } from "../turns.ts";
import { MAX_REALTIME_SDP_BYTES, type CodexRealtimePeer, type CodexRealtimePeerEvent } from "./peer.ts";
import { fetch as undiciFetch, ProxyAgent, type Response } from "undici";

const V3_MODEL = "gpt-live-1-codex";
const HANDOFF_CHUNK_BYTES = 500;
const HANDOFF_FLUSH_MS = 200;
const PEER_READY_TIMEOUT_MS = 15_000;

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
	onStatus(status: string): void;
	onTurn(turn: RealtimeVoiceTurn): void;
	onTranscriptTail(transcriptDelta: string): void;
}

type RealtimeCallResult = { status: number; answer: string };
type RealtimeCallSetup = (endpoint: string, headers: Headers, signal: AbortSignal, body: string, env?: Record<string, string>) => Promise<RealtimeCallResult>;

export class CodexRealtimeConversation {
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly turnTracker = new RealtimeVoiceTurnTracker();
	private state: ConversationState = "idle";
	private activeDelegationId: string | undefined;
	private handoffBuffer = "";
	private handoffChannel: "commentary" | "speakable" = "speakable";
	private handoffTimer: ReturnType<typeof setTimeout> | undefined;
	private setupAbortController: AbortController | undefined;
	private peerReady: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private callSetup: RealtimeCallSetup = setupRealtimeCall;
	private inputMuted = false;

	constructor(callbacks: CodexConversationCallbacks, peer: CodexRealtimePeer) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.peer.onEvent((event) => this.handlePeerEvent(event));
		this.peer.onExit((error) => this.fail(error));
	}

	async start(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string): Promise<void> {
		this.state = "starting";
		const sdp = await this.peer.start(config);
		if (this.state !== "starting") return;
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		headers.set("content-type", "application/json");
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls?intent=quicksilver&architecture=avas`;
		const setupAbortController = new AbortController();
		this.setupAbortController = setupAbortController;
		const requestBody = JSON.stringify({ sdp, session: { model: V3_MODEL, instructions, audio: { output: { voice: config.voice.v3Voice } }, delegation: { type: "client" } } });
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
		if (this.state !== "active" || this.activeDelegationId === id) return;
		const previousDelegationId = this.activeDelegationId;
		this.flushHandoff();
		if (this.state !== "active") return;
		if (previousDelegationId) this.turnTracker.delegationSettled(previousDelegationId);
		this.activeDelegationId = id;
	}

	get microphoneMuted(): boolean { return this.inputMuted; }

	setInputMuted(muted: boolean): void {
		if (this.state !== "active" || this.inputMuted === muted) return;
		this.peer.setInputMuted(muted);
		this.inputMuted = muted;
	}

	mirrorPiSteer(input: unknown): boolean {
		const delegationId = this.activeDelegationId;
		const frame = renderPiSteer(input);
		if (this.state !== "active" || !delegationId || !frame) return false;
		this.flushHandoff();
		if (this.state !== "active" || this.activeDelegationId !== delegationId) return false;
		try {
			for (const text of utf8Chunks(frame, HANDOFF_CHUNK_BYTES)) {
				this.peer.sendData({ type: "delegation.context.append", delegation_item_id: delegationId, channel: "commentary", content: [{ type: "input_text", text }] });
			}
			return true;
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return false;
		}
	}

	streamAgentDelta(type: string, delta: string): void {
		if (this.state !== "active" || !this.activeDelegationId || !delta) return;
		this.callbacks.onStatus("speaking");
		const channel = type === "thinking_delta" ? "commentary" : "speakable";
		if (this.handoffBuffer && channel !== this.handoffChannel) this.flushHandoff();
		this.handoffChannel = channel;
		this.handoffBuffer += delta;
		if (!this.handoffTimer) this.handoffTimer = setTimeout(() => this.flushHandoff(), HANDOFF_FLUSH_MS);
	}

	settleAgentTurn(): void {
		this.flushHandoff();
		if (this.activeDelegationId) this.turnTracker.delegationSettled(this.activeDelegationId);
		this.activeDelegationId = undefined;
		if (this.state === "active") this.callbacks.onStatus("listening");
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.abortSetup();
		this.clearHandoff();
		for (const turn of this.turnTracker.drainConversationTurns()) this.callbacks.onTurn(turn);
		const transcriptTail = this.turnTracker.takeTranscriptTail();
		if (transcriptTail) this.callbacks.onTranscriptTail(transcriptTail);
		this.turnTracker.reset();
		this.activeDelegationId = undefined;
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
		this.flushHandoff();
		this.callbacks.onTurn(delegated);
	}

	private handleCompletedTurn(turn: unknown): void {
		if (!turn || typeof turn !== "object") return;
		const record = turn as Record<string, unknown>;
		if (record["role"] === "user") {
			const input = boundedTranscript(record["transcript"]);
			if (input === "oversized") { this.fail(new Error("Codex voice transcript was oversized")); return; }
			if (input) this.turnTracker.userFinished(input);
			this.callbacks.onStatus("responding");
			return;
		}
		if (record["role"] !== "assistant") return;
		const completed = this.turnTracker.assistantFinished(boundedAssistantTranscript(record["transcript"]));
		this.callbacks.onStatus("listening");
		if (completed) this.callbacks.onTurn(completed);
	}

	private flushHandoff(): void {
		if (this.handoffTimer) clearTimeout(this.handoffTimer);
		this.handoffTimer = undefined;
		if (this.state !== "active" || !this.activeDelegationId || !this.handoffBuffer) return;
		try {
			for (const text of utf8Chunks(this.handoffBuffer, HANDOFF_CHUNK_BYTES)) {
				this.peer.sendData({ type: "delegation.context.append", delegation_item_id: this.activeDelegationId, channel: this.handoffChannel, content: [{ type: "input_text", text }] });
			}
			this.handoffBuffer = "";
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	private clearHandoff(): void {
		if (this.handoffTimer) clearTimeout(this.handoffTimer);
		this.handoffTimer = undefined;
		this.handoffBuffer = "";
	}

	private abortSetup(): void {
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
	}

	private fail(error: Error): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.abortSetup();
		this.clearHandoff();
		this.peerReady?.resolve();
		this.peerReady = undefined;
		this.callbacks.onError(error);
		void this.peer.close();
	}
}

async function setupRealtimeCall(endpoint: string, headers: Headers, signal: AbortSignal, body: string, env?: Record<string, string>): Promise<RealtimeCallResult> {
	const proxy = await resolveWebSocketProxyForTarget(endpoint, env);
	const dispatcher = proxy ? new ProxyAgent(proxy) : undefined;
	try {
		const response = await undiciFetch(endpoint, {
			method: "POST",
			headers: Object.fromEntries(headers),
			signal,
			body,
			...(dispatcher ? { dispatcher } : {}),
		});
		return { status: response.status, answer: await readBoundedResponseText(response, MAX_REALTIME_SDP_BYTES) };
	} finally {
		await dispatcher?.close();
	}
}

async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string> {
	const declaredBytes = Number(response.headers.get("content-length"));
	if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) throw new Error(`Codex voice response exceeded ${maxBytes} bytes`);
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Buffer[] = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			const chunk = Buffer.from(value);
			bytes += chunk.byteLength;
			if (bytes > maxBytes) {
				await reader.cancel().catch(() => {});
				throw new Error(`Codex voice response exceeded ${maxBytes} bytes`);
			}
			chunks.push(chunk);
		}
	} finally {
		reader.releaseLock();
	}
	return Buffer.concat(chunks, bytes).toString("utf8");
}

function boundedTranscript(value: unknown): string | "oversized" | undefined {
	if (typeof value !== "string") return undefined;
	const input = value.trim();
	if (!input) return undefined;
	return Buffer.byteLength(input) > MAX_REALTIME_VOICE_INPUT_BYTES ? "oversized" : input;
}

function transcriptItemText(value: unknown): unknown {
	return value && typeof value === "object" ? (value as Record<string, unknown>)["text"] : undefined;
}

function boundedAssistantTranscript(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const output = value.trim();
	if (!output) return undefined;
	return utf8Tail(output, MAX_REALTIME_VOICE_INPUT_BYTES - 32);
}

function utf8Tail(value: string, maxBytes: number): string {
	if (Buffer.byteLength(value) <= maxBytes) return value;
	let start = value.length;
	let bytes = 0;
	while (start > 0) {
		let characterStart = start - 1;
		const lastUnit = value.charCodeAt(characterStart);
		if (lastUnit >= 0xdc00 && lastUnit <= 0xdfff && characterStart > 0) characterStart--;
		const characterBytes = Buffer.byteLength(value.slice(characterStart, start));
		if (bytes + characterBytes > maxBytes) break;
		bytes += characterBytes;
		start = characterStart;
	}
	return value.slice(start);
}

function remoteError(event: Record<string, unknown>): string {
	if (typeof event["message"] === "string") return event["message"];
	const error = event["error"];
	return error && typeof error === "object" && typeof (error as Record<string, unknown>)["message"] === "string" ? (error as Record<string, unknown>)["message"] as string : "Codex realtime error";
}

export function utf8Chunks(input: string, maxBytes: number): string[] {
	const chunks: string[] = [];
	let current = "";
	for (const character of input) {
		if (Buffer.byteLength(current + character) > maxBytes && current) { chunks.push(current); current = character; }
		else current += character;
	}
	if (current) chunks.push(current);
	return chunks;
}

function realtimePeerStateFailure(state: string): string | undefined {
	if (state === "failed") return "Codex realtime connection failed";
	if (state === "closed") return "Codex realtime connection closed";
	return undefined;
}
