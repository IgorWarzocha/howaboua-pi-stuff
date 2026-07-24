import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import { RealtimeVoiceTurnTracker, type RealtimeVoiceTurn } from "../turns.ts";

const V3_MODEL = "gpt-live-1-boulder-alpha";
const MAX_DELEGATION_BYTES = 32 * 1024;
const HANDOFF_CHUNK_BYTES = 500;
const HANDOFF_FLUSH_MS = 200;

type ConversationState = "idle" | "starting" | "active" | "failed" | "closed";

export interface CodexConversationCallbacks {
	onError(error: Error): void;
	onStatus(status: string): void;
	onTurn(turn: RealtimeVoiceTurn): void;
}

export class CodexRealtimeConversation {
	private readonly callbacks: CodexConversationCallbacks;
	private readonly helper = new VoiceHelperClient();
	private readonly turnTracker = new RealtimeVoiceTurnTracker();
	private state: ConversationState = "idle";
	private activeDelegationId: string | undefined;
	private handoffBuffer = "";
	private handoffChannel: "commentary" | "speakable" = "speakable";
	private handoffTimer: ReturnType<typeof setTimeout> | undefined;

	constructor(callbacks: CodexConversationCallbacks) {
		this.callbacks = callbacks;
		this.helper.onEvent((event) => this.handleHelperEvent(event));
		this.helper.onExit((error) => this.fail(error));
	}

	async start(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string): Promise<void> {
		this.state = "starting";
		await this.helper.start();
		if (this.state !== "starting") return;
		const offer = Promise.withResolvers<string>();
		const removeEvent = this.helper.onEvent((event) => {
			if (event.type === "offer") offer.resolve(event.sdp);
			else if (event.type === "error") offer.reject(new Error(event.message));
		});
		const removeExit = this.helper.onExit((error) => offer.reject(error));
		const timeout = setTimeout(() => offer.reject(new Error("Codex voice helper did not create an offer")), 15_000);
		this.helper.send({
			type: "start_v3",
			...(config.voice.inputDevice ? { microphone: config.voice.inputDevice } : {}),
			...(config.voice.outputDevice ? { speaker: config.voice.outputDevice } : {}),
		});
		const sdp = await offer.promise.finally(() => { clearTimeout(timeout); removeEvent(); removeExit(); });
		if (this.state !== "starting") return;
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		headers.set("content-type", "application/json");
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls?intent=quicksilver&architecture=avas`;
		const response = await fetch(endpoint, {
			method: "POST",
			headers,
			body: JSON.stringify({ sdp, session: { model: V3_MODEL, instructions, audio: { output: { voice: config.voice.v3Voice } }, delegation: { type: "client" } } }),
		});
		const answer = await response.text();
		if (this.state !== "starting") return;
		if (response.status !== 201) throw new Error(`Codex voice call failed (${response.status}): ${answer.slice(0, 1_000)}`);
		this.state = "active";
		this.helper.send({ type: "apply_answer", sdp: answer });
		this.callbacks.onStatus("connecting…");
	}

	activateDelegation(id: string): void {
		if (this.state === "active") this.activeDelegationId = id;
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
		this.activeDelegationId = undefined;
		if (this.state === "active") this.callbacks.onStatus("listening");
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.clearHandoff();
		this.turnTracker.reset();
		this.activeDelegationId = undefined;
		await this.helper.close();
	}

	private handleHelperEvent(event: VoiceHelperEvent): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		if (event.type === "error") { this.fail(new Error(event.message)); return; }
		if (event.type === "data") this.handleServerEvent(event.message);
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private handleHelperState(state: string): void {
		if (state === "ready" || state === "listening") this.callbacks.onStatus("listening");
		else if (state === "connecting" || state === "connected") this.callbacks.onStatus("connecting…");
		else if (state === "disconnected") this.callbacks.onStatus("reconnecting…");
	}

	private handleServerEvent(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const event = value as Record<string, unknown>;
		if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
		if (event["type"] === "input_transcript.added") return;
		if (event["type"] === "output_transcript.added") { this.callbacks.onStatus("speaking"); return; }
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
		if (!input || Buffer.byteLength(input) > MAX_DELEGATION_BYTES) { this.fail(new Error("Codex voice delegation was empty or oversized")); return; }
		this.flushHandoff();
		this.callbacks.onTurn(this.turnTracker.delegated(input, record["id"]));
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
		const completed = this.turnTracker.assistantFinished();
		this.callbacks.onStatus("listening");
		if (completed) this.callbacks.onTurn(completed);
	}

	private flushHandoff(): void {
		if (this.handoffTimer) clearTimeout(this.handoffTimer);
		this.handoffTimer = undefined;
		if (this.state !== "active" || !this.activeDelegationId || !this.handoffBuffer) return;
		try {
			for (const text of utf8Chunks(this.handoffBuffer, HANDOFF_CHUNK_BYTES)) {
				this.helper.send({ type: "send_data", message: { type: "delegation.context.append", delegation_item_id: this.activeDelegationId, channel: this.handoffChannel, content: [{ type: "input_text", text }] } });
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

	private fail(error: Error): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.clearHandoff();
		this.callbacks.onError(error);
		void this.helper.close();
	}
}

function boundedTranscript(value: unknown): string | "oversized" | undefined {
	if (typeof value !== "string") return undefined;
	const input = value.trim();
	if (!input) return undefined;
	return Buffer.byteLength(input) > MAX_DELEGATION_BYTES ? "oversized" : input;
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
