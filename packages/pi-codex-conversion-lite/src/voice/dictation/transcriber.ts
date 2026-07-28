import { closeWebSocketSilently, connectWebSocket, extractWebSocketError } from "../../providers/openai-codex/websocket-connection.ts";
import type { WebSocketLike } from "../../providers/openai-codex/types.ts";
import type { CodexVoiceAuth } from "../auth.ts";

const MIN_AUDIO_BYTES = 4_800;
const COMPLETION_TIMEOUT_MS = 10_000;
const MAX_TRANSCRIPTION_EVENT_BYTES = 72 * 1024;
const MAX_TRANSCRIPT_BYTES = 64 * 1024;

type TranscriberState = "idle" | "starting" | "recording" | "finishing" | "failed" | "closed";

export interface CodexDictationTranscriberCallbacks {
	onError(error: Error): void;
	onStatus(status: string): void;
}

export class CodexDictationTranscriber {
	private readonly callbacks: CodexDictationTranscriberCallbacks;
	private readonly connector: typeof connectWebSocket;
	private state: TranscriberState = "idle";
	private socket: WebSocketLike | undefined;
	private audioBytes = 0;
	private completion: ReturnType<typeof Promise.withResolvers<string | undefined>> | undefined;
	private setupAbortController: AbortController | undefined;

	constructor(callbacks: CodexDictationTranscriberCallbacks, connector: typeof connectWebSocket = connectWebSocket) {
		this.callbacks = callbacks;
		this.connector = connector;
	}

	async start(auth: CodexVoiceAuth): Promise<void> {
		if (!auth.officialCodex) throw new Error("Codex dictation does not support custom provider base URLs");
		this.state = "starting";
		const setupAbortController = new AbortController();
		this.setupAbortController = setupAbortController;
		try {
			const socket = await this.connector("wss://api.openai.com/v1/realtime?intent=transcription", new Headers(auth.headers), setupAbortController.signal, 10_000, auth.env);
			if (this.state !== "starting") { closeWebSocketSilently(socket); return; }
			this.socket = socket;
			socket.addEventListener("message", (event) => this.receive(event));
			socket.addEventListener("error", (event) => this.fail(extractWebSocketError(event)));
			socket.addEventListener("close", (event) => {
				if (this.state !== "closed" && this.state !== "failed") this.fail(new Error(`Codex dictation closed${closeReason(event)}`));
			});
			socket.send(JSON.stringify(buildDictationSessionUpdate()));
			this.state = "recording";
			this.callbacks.onStatus("listening");
		} catch (error) {
			const failure = error instanceof Error ? error : new Error(String(error));
			this.fail(failure);
			throw failure;
		} finally {
			if (this.setupAbortController === setupAbortController) this.setupAbortController = undefined;
		}
	}

	append(pcm: Buffer): void {
		if (this.state !== "recording" || !this.socket || pcm.byteLength === 0) return;
		this.audioBytes += pcm.byteLength;
		this.socket.send(JSON.stringify({ type: "input_audio_buffer.append", audio: pcm.toString("base64") }));
	}

	async finish(): Promise<string | undefined> {
		if (this.state !== "recording" || !this.socket) { await this.close(); return undefined; }
		this.state = "finishing";
		this.callbacks.onStatus("transcribing");
		if (this.audioBytes < MIN_AUDIO_BYTES) { await this.close(); return undefined; }
		const completion = Promise.withResolvers<string | undefined>();
		this.completion = completion;
		this.socket.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
		let timeout: ReturnType<typeof setTimeout> | undefined;
		try {
			return await Promise.race([
				completion.promise,
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error("Codex dictation transcription timed out")), COMPLETION_TIMEOUT_MS);
				}),
			]);
		} finally {
			if (timeout) clearTimeout(timeout);
			if (this.completion === completion) this.completion = undefined;
			await this.close();
		}
	}

	async close(): Promise<void> {
		if (this.state === "closed") return;
		this.state = "closed";
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
		this.completion?.resolve(undefined);
		this.completion = undefined;
		if (this.socket) closeWebSocketSilently(this.socket);
		this.socket = undefined;
	}

	private receive(raw: unknown): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		if (!raw || typeof raw !== "object" || !("data" in raw) || typeof raw.data !== "string") {
			this.fail(new Error("Codex dictation emitted an invalid event"));
			return;
		}
		if (Buffer.byteLength(raw.data) > MAX_TRANSCRIPTION_EVENT_BYTES) {
			this.fail(new Error("Codex dictation emitted an oversized event"));
			return;
		}
		let event: Record<string, unknown>;
		try {
			const value = JSON.parse(raw.data) as unknown;
			if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
			event = value as Record<string, unknown>;
		} catch {
			this.fail(new Error("Codex dictation emitted an invalid event"));
			return;
		}
		if (event["type"] === "error") { this.fail(new Error(remoteError(event))); return; }
		if (event["type"] === "conversation.item.input_audio_transcription.delta" && typeof event["delta"] === "string") {
			this.callbacks.onStatus("transcribing");
			return;
		}
		if (event["type"] === "conversation.item.input_audio_transcription.completed" || event["type"] === "input_audio_transcription.completed") {
			if (typeof event["transcript"] !== "string") { this.fail(new Error("Codex dictation returned an invalid transcript")); return; }
			const transcript = event["transcript"].trim();
			if (Buffer.byteLength(transcript) > MAX_TRANSCRIPT_BYTES) { this.fail(new Error("Codex dictation returned an oversized transcript")); return; }
			this.completion?.resolve(transcript || undefined);
		}
	}

	private fail(error: Error): void {
		if (this.state === "idle" || this.state === "closed" || this.state === "failed") return;
		this.state = "failed";
		this.setupAbortController?.abort();
		this.setupAbortController = undefined;
		this.completion?.reject(error);
		this.completion = undefined;
		if (this.socket) closeWebSocketSilently(this.socket);
		this.socket = undefined;
		this.callbacks.onError(error);
	}
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
