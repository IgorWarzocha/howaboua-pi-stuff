import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { connectWebSocket, closeWebSocketSilently } from "../../providers/openai-codex/websocket-connection.ts";
import type { WebSocketLike } from "../../providers/openai-codex/types.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";

const MIN_AUDIO_BYTES = 4_800;
const COMPLETION_TIMEOUT_MS = 10_000;

type DictationState = "idle" | "starting" | "recording" | "finishing" | "failed" | "closed";

export interface CodexDictationCallbacks {
	onError(error: Error): void;
	onStatus(status: string): void;
	onTranscript(transcript: string): void;
}

export class CodexDictationSession {
	private readonly callbacks: CodexDictationCallbacks;
	private readonly helper = new VoiceHelperClient();
	private state: DictationState = "idle";
	private socket: WebSocketLike | undefined;
	private audioBytes = 0;
	private completion: ReturnType<typeof Promise.withResolvers<void>> | undefined;
	private setupAbortController: AbortController | undefined;
	private startupFailure: Error | undefined;
	private connector = connectWebSocket;

	constructor(callbacks: CodexDictationCallbacks) {
		this.callbacks = callbacks;
		this.helper.onEvent((event) => this.handleHelperEvent(event));
		this.helper.onExit((error) => this.fail(error));
	}

	async start(auth: CodexVoiceAuth, config: CodexConversionConfig): Promise<void> {
		if (!auth.officialCodex) throw new Error("Codex dictation does not support custom provider base URLs");
		this.state = "starting";
		this.startupFailure = undefined;
		try {
			await this.helper.start();
			if (this.state !== "starting") {
				if (this.startupFailure) throw this.startupFailure;
				return;
			}
			const setupAbortController = new AbortController();
			this.setupAbortController = setupAbortController;
			let socket: WebSocketLike;
			try {
				socket = await this.connector("wss://api.openai.com/v1/realtime?intent=transcription", new Headers(auth.headers), setupAbortController.signal, 10_000, auth.env);
			} finally {
				if (this.setupAbortController === setupAbortController) this.setupAbortController = undefined;
			}
			if (this.state !== "starting") {
				closeWebSocketSilently(socket);
				if (this.startupFailure) throw this.startupFailure;
				return;
			}
			this.socket = socket;
			socket.addEventListener("message", (event) => this.handleSocketMessage(event));
			socket.addEventListener("close", (event) => {
				if (this.state !== "closed" && this.state !== "failed") this.fail(new Error(`Codex dictation closed${closeReason(event)}`));
			});
			socket.send(JSON.stringify(buildDictationSessionUpdate()));
			this.helper.send({
				type: "start_dictation",
				...(config.voice.inputDevice ? { microphone: config.voice.inputDevice } : {}),
			});
			this.state = "recording";
			this.callbacks.onStatus("listening");
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.fail(failure);
			await this.helper.close();
			throw failure;
		}
	}

	async finish(): Promise<void> {
		if (this.state === "closed" || this.state === "failed" || this.state === "idle") return;
		this.state = "finishing";
		this.abortSetup();
		this.callbacks.onStatus("transcribing");
		try {
			await this.helper.stop();
			if (this.state !== "finishing") return;
			if (this.audioBytes >= MIN_AUDIO_BYTES && this.socket) await this.commitAndWait(this.socket);
			await this.close();
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.abortSetup();
		this.completion?.resolve();
		this.completion = undefined;
		if (this.socket) closeWebSocketSilently(this.socket);
		this.socket = undefined;
		await this.helper.close();
	}

	private async commitAndWait(socket: WebSocketLike): Promise<void> {
		const completion = Promise.withResolvers<void>();
		this.completion = completion;
		socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				completion.promise,
				new Promise<void>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error("Codex dictation transcription timed out")), COMPLETION_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.completion === completion) this.completion = undefined;
		}
	}

	private handleHelperEvent(event: VoiceHelperEvent): void {
		if (event.type === "error") { this.fail(new Error(event.message)); return; }
		if (event.type !== "pcm" || !this.socket || (this.state !== "recording" && this.state !== "finishing")) return;
		this.audioBytes += decodedBase64ByteLength(event.audio);
		this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: event.audio }));
	}

	private handleSocketMessage(raw: unknown): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		if (!raw || typeof raw !== "object" || !("data" in raw)) return;
		try {
			const event = JSON.parse(String((raw as { data: unknown }).data)) as Record<string, unknown>;
			if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
			if (event["type"] === "conversation.item.input_audio_transcription.delta" && typeof event["delta"] === "string") {
				this.callbacks.onStatus("transcribing");
				return;
			}
			if (event["type"] === "conversation.item.input_audio_transcription.completed" || event["type"] === "input_audio_transcription.completed") {
				if (typeof event["transcript"] === "string" && event["transcript"].trim()) this.callbacks.onTranscript(event["transcript"].trim());
				this.completion?.resolve();
			}
		} catch {}
	}

	private fail(error: Error): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.startupFailure = error;
		this.abortSetup();
		this.completion?.reject(error);
		this.completion = undefined;
		if (this.socket) closeWebSocketSilently(this.socket);
		this.socket = undefined;
		this.callbacks.onError(error);
		void this.helper.close();
	}

	private abortSetup(): void {
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
	}
}

function decodedBase64ByteLength(value: string): number {
	if (!value) return 0;
	const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
	return Math.max(0, Math.floor(value.length * 3 / 4) - padding);
}

function buildDictationSessionUpdate(): Record<string, unknown> {
	return {
		type: "session.update",
		session: {
			type: "transcription",
			audio: {
				input: {
					format: { type: "audio/pcm", rate: 24_000 },
					noise_reduction: { type: "near_field" },
					transcription: { model: "gpt-4o-mini-transcribe" },
					turn_detection: null,
				},
			},
		},
	};
}

function remoteError(event: Record<string, unknown>): string {
	if (typeof event["message"] === "string") return event["message"];
	const error = event["error"];
	return error && typeof error === "object" && typeof (error as Record<string, unknown>)["message"] === "string" ? (error as Record<string, unknown>)["message"] as string : "Codex dictation error";
}

function closeReason(event: unknown): string {
	if (!event || typeof event !== "object") return "";
	const value = event as Record<string, unknown>;
	return `${typeof value["code"] === "number" ? ` (${value["code"]})` : ""}${typeof value["reason"] === "string" && value["reason"] ? `: ${value["reason"]}` : ""}`;
}
