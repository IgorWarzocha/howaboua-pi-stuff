import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { extractAccountId } from "../providers/openai-codex/headers.ts";
import { connectWebSocket, closeWebSocketSilently } from "../providers/openai-codex/websocket-connection.ts";
import type { WebSocketLike } from "../providers/openai-codex/types.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "./helper.ts";
import { loadCodexVoiceSystemPrompt } from "./system-prompt.ts";
import { RealtimeVoiceTurnTracker, type RealtimeVoiceTurn } from "./turns.ts";
import { codexVoiceModeMessage, realtimeVoiceMessage, type CodexVoiceMode, type CodexVoiceModeState } from "./ui.ts";

const V3_MODEL = "gpt-live-1-boulder-alpha";
const MAX_DELEGATION_BYTES = 32 * 1024;
const HANDOFF_CHUNK_BYTES = 500;
const HANDOFF_FLUSH_MS = 200;

type VoiceState =
	| { type: "idle" }
	| { type: "connecting"; mode: "conversation" | "dictation" }
	| { type: "conversation"; activeDelegationId?: string }
	| { type: "dictation"; socket: WebSocketLike }
	| { type: "failed"; message: string };

interface ProviderAuth {
	token: string;
	accountId: string;
	headers: Headers;
	baseUrl: string;
	officialCodex: boolean;
	env?: Record<string, string>;
}

type PendingVoiceMessage =
	| { type: "mode"; mode: CodexVoiceMode; state: CodexVoiceModeState }
	| { type: "turn"; turn: RealtimeVoiceTurn };

export class CodexVoiceController {
	private readonly pi: ExtensionAPI;
	private state: VoiceState = { type: "idle" };
	private helper = new VoiceHelperClient();
	private context: ExtensionContext | undefined;
	private handoffBuffer = "";
	private handoffChannel: "commentary" | "speakable" = "speakable";
	private handoffTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly turnTracker = new RealtimeVoiceTurnTracker();
	private pendingMessages: PendingVoiceMessage[] = [];
	private piTurnActive = false;
	private backendTurnPending = false;
	private announcedMode: CodexVoiceMode | undefined;

	constructor(pi: ExtensionAPI) {
		this.pi = pi;
		this.helper.onEvent((event) => this.handleHelperEvent(event));
		this.helper.onExit((error) => this.fail(error));
	}

	get status(): string { return this.state.type; }
	get active(): boolean { return this.state.type !== "idle" && this.state.type !== "failed"; }
	get activeMode(): CodexVoiceMode | undefined { return this.announcedMode; }

	async start(ctx: ExtensionContext, config: CodexConversionConfig): Promise<void> {
		const mode = config.voice.mode === "transcription" ? "dictation" : "conversation";
		const realtimePrompt = mode === "conversation" ? loadCodexVoiceSystemPrompt() : undefined;
		await this.stop({ announce: true });
		this.context = ctx;
		this.state = { type: "connecting", mode };
		this.renderStatus("connecting…");
		try {
			const auth = await this.resolveAuth(ctx);
			await this.helper.start();
			if (mode === "dictation") await this.startDictation(auth, config);
			else await this.startConversation(auth, config, realtimePrompt!);
			this.announceModeStarted(mode === "dictation" ? "dictation" : "realtime");
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
			throw error;
		}
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		const endedMode = options?.announce ? this.announcedMode : undefined;
		const ctx = this.context;
		if (this.handoffTimer) clearTimeout(this.handoffTimer);
		this.handoffTimer = undefined;
		this.handoffBuffer = "";
		this.turnTracker.reset();
		this.pendingMessages = [];
		this.backendTurnPending = false;
		this.piTurnActive = ctx ? !ctx.isIdle() : false;
		this.announcedMode = undefined;
		if (this.state.type === "dictation") closeWebSocketSilently(this.state.socket);
		this.state = { type: "idle" };
		ctx?.ui.setStatus("codex-voice", undefined);
		await this.helper.close();
		if (endedMode && ctx) {
			this.context = ctx;
			this.enqueueModeMessage(endedMode, "ended");
		} else {
			this.context = undefined;
		}
	}

	consumeDelegatedTurnStart(): boolean {
		if (!this.backendTurnPending) return false;
		this.backendTurnPending = false;
		return true;
	}

	agentStarted(): void {
		this.piTurnActive = true;
	}

	streamDelta(type: string, delta: string): void {
		if (this.state.type !== "conversation" || !this.state.activeDelegationId || !delta) return;
		this.renderStatus("speaking");
		const channel = type === "thinking_delta" ? "commentary" : "speakable";
		if (this.handoffBuffer && channel !== this.handoffChannel) this.flushHandoff();
		this.handoffChannel = channel;
		this.handoffBuffer += delta;
		if (!this.handoffTimer) this.handoffTimer = setTimeout(() => this.flushHandoff(), HANDOFF_FLUSH_MS);
	}

	settleTurn(): void {
		this.flushHandoff();
		if (this.state.type === "conversation") delete this.state.activeDelegationId;
		this.piTurnActive = false;
		if (this.active) this.renderStatus("listening");
		this.flushPendingMessages();
	}

	private async resolveAuth(ctx: ExtensionContext): Promise<ProviderAuth> {
		const resolved = await ctx.modelRegistry.getProviderAuth("openai-codex");
		const token = resolved?.auth.apiKey;
		if (!token) throw new Error("OpenAI Codex login is required before starting voice");
		const accountId = extractAccountId(token);
		const headers = new Headers();
		for (const [name, value] of Object.entries(resolved.auth.headers ?? {})) if (value !== null) headers.set(name, value);
		headers.set("authorization", `Bearer ${token}`);
		headers.set("chatgpt-account-id", accountId);
		headers.set("originator", "pi");
		headers.set("x-session-id", ctx.sessionManager.getSessionId());
		headers.set("user-agent", "pi-codex-conversion");
		const baseUrl = resolved.auth.baseUrl ?? "https://chatgpt.com/backend-api/codex";
		return { token, accountId, headers, baseUrl, officialCodex: isOfficialCodexBaseUrl(baseUrl), ...(resolved.env ? { env: resolved.env } : {}) };
	}

	private async startConversation(auth: ProviderAuth, config: CodexConversionConfig, instructions: string): Promise<void> {
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
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		headers.set("content-type", "application/json");
		const endpoint = `${auth.baseUrl.replace(/\/+$/, "")}/realtime/calls?intent=quicksilver&architecture=avas`;
		const response = await fetch(endpoint, {
			method: "POST", headers,
			body: JSON.stringify({ sdp, session: { model: V3_MODEL, instructions, audio: { output: { voice: config.voice.v3Voice } }, delegation: { type: "client" } } }),
		});
		const answer = await response.text();
		if (response.status !== 201) throw new Error(`Codex voice call failed (${response.status}): ${answer.slice(0, 1_000)}`);
		this.state = { type: "conversation" };
		this.helper.send({ type: "apply_answer", sdp: answer });
		this.renderStatus("connecting…");
	}

	private async startDictation(auth: ProviderAuth, config: CodexConversionConfig): Promise<void> {
		if (!auth.officialCodex) throw new Error("Codex dictation does not support custom provider base URLs");
		const headers = new Headers(auth.headers);
		const socket = await connectWebSocket("wss://api.openai.com/v1/realtime?intent=transcription", headers, undefined, 10_000, auth.env);
		this.state = { type: "dictation", socket };
		socket.addEventListener("message", (event) => this.handleDictationMessage(event));
		socket.addEventListener("close", (event) => { if (this.state.type === "dictation") this.fail(new Error(`Codex dictation closed${closeReason(event)}`)); });
		socket.send(JSON.stringify({ type: "session.update", session: { type: "transcription", audio: { input: { format: { type: "audio/pcm", rate: 24_000 }, noise_reduction: { type: "near_field" }, transcription: { model: "gpt-4o-mini-transcribe" }, turn_detection: { type: "server_vad", prefix_padding_ms: 300, silence_duration_ms: 600 } } } } }));
		this.helper.send({
			type: "start_dictation",
			...(config.voice.inputDevice ? { microphone: config.voice.inputDevice } : {}),
		});
		this.renderStatus("listening");
	}

	private handleHelperEvent(event: VoiceHelperEvent): void {
		if (event.type === "error") { this.fail(new Error(event.message)); return; }
		if (event.type === "pcm" && this.state.type === "dictation") {
			this.state.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: event.audio }));
			return;
		}
		if (event.type === "data") this.handleV3Message(event.message);
		if (event.type === "state") this.handleHelperState(event.state);
	}

	private handleHelperState(state: string): void {
		if (state === "ready" || state === "listening") this.renderStatus("listening");
		else if (state === "connecting" || state === "connected") this.renderStatus("connecting…");
		else if (state === "disconnected") this.renderStatus("reconnecting…");
	}

	private handleV3Message(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const event = value as Record<string, unknown>;
		if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
		if (event["type"] === "input_transcript.added") return;
		if (event["type"] === "output_transcript.added") { this.renderStatus("speaking"); return; }
		if (event["type"] === "turn.done") {
			const turn = event["turn"];
			if (turn && typeof turn === "object") {
				const record = turn as Record<string, unknown>;
				const role = record["role"];
				if (role === "user") {
					const input = boundedTranscript(record["transcript"]);
					if (input === "oversized") { this.fail(new Error("Codex voice transcript was oversized")); return; }
					if (input) this.turnTracker.userFinished(input);
					this.renderStatus("responding");
				} else if (role === "assistant") {
					const completed = this.turnTracker.assistantFinished();
					this.renderStatus("listening");
					if (completed) this.enqueueVoiceTurn(completed);
				}
			}
			return;
		}
		if (event["type"] !== "delegation.created" || this.state.type !== "conversation") return;
		const item = event["item"];
		if (!item || typeof item !== "object") return;
		const record = item as Record<string, unknown>;
		if (record["type"] !== "delegation" || record["target"] !== "client" || typeof record["id"] !== "string" || !Array.isArray(record["content"])) return;
		const input = record["content"].flatMap((part) => part && typeof part === "object" && (part as Record<string, unknown>)["type"] === "input_text" && typeof (part as Record<string, unknown>)["text"] === "string" ? [(part as Record<string, unknown>)["text"] as string] : []).join("").trim();
		if (!input || Buffer.byteLength(input) > MAX_DELEGATION_BYTES) { this.fail(new Error("Codex voice delegation was empty or oversized")); return; }
		this.flushHandoff();
		this.enqueueVoiceTurn(this.turnTracker.delegated(input, record["id"]));
	}

	private enqueueVoiceTurn(turn: RealtimeVoiceTurn): void {
		this.pendingMessages.push({ type: "turn", turn });
		this.flushPendingMessages();
	}

	private announceModeStarted(mode: CodexVoiceMode): void {
		this.announcedMode = mode;
		this.enqueueModeMessage(mode, "started");
	}

	private enqueueModeMessage(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
		this.pendingMessages.push({ type: "mode", mode, state });
		this.flushPendingMessages();
	}

	private flushPendingMessages(): void {
		// Session history stays append-only: hold voice messages while Pi is active,
		// then append state/conversation cards and stop after one turn-triggering delegation.
		const ctx = this.context;
		if (this.piTurnActive || !ctx?.isIdle()) return;
		while (this.pendingMessages.length > 0) {
			const message = this.pendingMessages.shift()!;
			if (message.type === "mode") {
				this.pi.sendMessage(codexVoiceModeMessage(message.mode, message.state), { triggerTurn: false });
				continue;
			}
			const { turn } = message;
			if (turn.delegationId) {
				if (this.state.type !== "conversation") continue;
				this.state.activeDelegationId = turn.delegationId;
				this.backendTurnPending = true;
				this.piTurnActive = true;
				this.renderStatus("working");
				this.pi.sendMessage(realtimeVoiceMessage(turn.input, "delegation"), { triggerTurn: true });
				return;
			}
			this.pi.sendMessage(realtimeVoiceMessage(turn.input, "conversation"), { triggerTurn: false });
		}
		if (!this.active) this.context = undefined;
	}

	private handleDictationMessage(raw: unknown): void {
		if (!raw || typeof raw !== "object" || !("data" in raw)) return;
		try {
			const event = JSON.parse(String((raw as { data: unknown }).data)) as Record<string, unknown>;
			if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
			if (event["type"] === "input_audio_buffer.speech_started") { this.renderStatus("listening"); return; }
			if (event["type"] === "input_audio_buffer.speech_stopped") { this.renderStatus("transcribing"); return; }
			if (event["type"] === "conversation.item.input_audio_transcription.delta" && typeof event["delta"] === "string") {
				this.renderStatus("transcribing");
				return;
			}
			if ((event["type"] === "conversation.item.input_audio_transcription.completed" || event["type"] === "input_audio_transcription.completed") && typeof event["transcript"] === "string" && event["transcript"].trim()) {
				this.context?.ui.pasteToEditor(event["transcript"].trim());
				this.renderStatus("listening");
			}
		} catch {}
	}

	private flushHandoff(): void {
		if (this.handoffTimer) clearTimeout(this.handoffTimer);
		this.handoffTimer = undefined;
		if (this.state.type !== "conversation" || !this.state.activeDelegationId || !this.handoffBuffer) return;
		for (const text of utf8Chunks(this.handoffBuffer, HANDOFF_CHUNK_BYTES)) {
			this.helper.send({ type: "send_data", message: { type: "delegation.context.append", delegation_item_id: this.state.activeDelegationId, channel: this.handoffChannel, content: [{ type: "input_text", text }] } });
		}
		this.handoffBuffer = "";
	}

	private renderStatus(status: string): void {
		const ctx = this.context;
		if (!ctx) return;
		ctx.ui.setStatus("codex-voice", ctx.ui.theme.fg("accent", `voice: ${status}`));
	}

	private fail(error: Error): void {
		if (this.state.type === "idle" || this.state.type === "failed") return;
		const endedMode = this.announcedMode;
		if (this.state.type === "dictation") closeWebSocketSilently(this.state.socket);
		this.state = { type: "failed", message: error.message };
		this.announcedMode = undefined;
		this.pendingMessages = [];
		this.context?.ui.setStatus("codex-voice", undefined);
		this.context?.ui.notify(error.message, "error");
		if (endedMode) this.enqueueModeMessage(endedMode, "ended");
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

function closeReason(event: unknown): string {
	if (!event || typeof event !== "object") return "";
	const value = event as Record<string, unknown>;
	return `${typeof value["code"] === "number" ? ` (${value["code"]})` : ""}${typeof value["reason"] === "string" && value["reason"] ? `: ${value["reason"]}` : ""}`;
}

function isOfficialCodexBaseUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === "https:" && url.hostname === "chatgpt.com" && /^\/backend-api\/codex\/?$/.test(url.pathname);
	} catch {
		return false;
	}
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
