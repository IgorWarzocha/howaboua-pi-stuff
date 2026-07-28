import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { closeWebSocketSilently, connectWebSocket, extractWebSocketCloseError, extractWebSocketError } from "../../providers/openai-codex/websocket-connection.ts";
import type { WebSocketLike } from "../../providers/openai-codex/types.ts";
import type { CodexVoiceAuth } from "../auth.ts";
import type { CodexRealtimePeerEvent, CodexRealtimeSessionPeer } from "../conversation/peer.ts";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";

const V3_MODEL = "gpt-live-1-boulder-alpha";
const SESSION_START_TIMEOUT_MS = 15_000;
const MAX_UPSTREAM_MESSAGE_BYTES = 2 * 1024 * 1024;

export class LanVoiceUpstreamPeer implements CodexRealtimeSessionPeer {
	readonly kind = "session" as const;
	private readonly diagnostics: LanVoiceDiagnostics;
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly connector: typeof connectWebSocket;
	private readonly eventListeners = new Set<(event: CodexRealtimePeerEvent) => void>();
	private readonly exitListeners = new Set<(error: Error) => void>();
	private socket: WebSocketLike | undefined;
	private closed = false;

	constructor(
		diagnostics: LanVoiceDiagnostics,
		onAudio: (pcm: Buffer) => void,
		connector: typeof connectWebSocket = connectWebSocket,
	) {
		this.diagnostics = diagnostics;
		this.onAudio = onAudio;
		this.connector = connector;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	trace(event: string, data?: unknown): void {
		this.diagnostics.write("realtime", event, data);
	}

	async startSession(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string): Promise<void> {
		if (this.closed) throw new Error("LAN voice realtime session is closed");
		const url = realtimeWebSocketUrl(auth.baseUrl);
		const headers = new Headers(auth.headers);
		headers.set("openai-alpha", "quicksilver=v2");
		this.trace("websocket.connect", { url, headers: traceHeaders(headers) });
		const socket = await this.connector(url, headers, undefined, SESSION_START_TIMEOUT_MS, auth.env);
		if (this.closed) { closeWebSocketSilently(socket); return; }
		this.socket = socket;
		const started = Promise.withResolvers<void>();
		const timeout = setTimeout(() => started.reject(new Error("Codex realtime session did not start")), SESSION_START_TIMEOUT_MS);
		const onMessage = (event: unknown) => {
			void this.receiveMessage(event).then((type) => {
				if (type === "session.started" || type === "session.updated") started.resolve();
			}).catch((error: unknown) => this.fail(error instanceof Error ? error : new Error(String(error))));
		};
		const onError = (event: unknown) => {
			const error = extractWebSocketError(event);
			started.reject(error);
			this.fail(error);
		};
		const onClose = (event: unknown) => {
			const error = extractWebSocketCloseError(event);
			started.reject(error);
			this.fail(error);
		};
		socket.addEventListener("message", onMessage);
		socket.addEventListener("error", onError);
		socket.addEventListener("close", onClose);
		this.sendRaw({
			type: "session.update",
			session: {
				instructions,
				audio: { output: { voice: config.voice.v3Voice } },
				delegation: { type: "client" },
			},
		});
		try {
			await started.promise;
			this.trace("websocket.started");
		} finally {
			clearTimeout(timeout);
		}
	}

	sendAudio(pcm: Buffer): void {
		this.sendRaw({ type: "input_audio.append", audio: pcm.toString("base64") });
	}

	sendData(message: unknown): void {
		this.sendRaw(message);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		const socket = this.socket;
		this.socket = undefined;
		if (socket) closeWebSocketSilently(socket, 1000, "done");
		this.trace("websocket.closed");
	}

	private sendRaw(message: unknown): void {
		const socket = this.socket;
		if (!socket || socket.readyState !== 1) throw new Error("Codex realtime WebSocket is not connected");
		this.trace("websocket.send", message);
		socket.send(JSON.stringify(message));
	}

	private async receiveMessage(event: unknown): Promise<string | undefined> {
		const data = event && typeof event === "object" && "data" in event ? (event as { data?: unknown }).data : undefined;
		const text = typeof data === "string" ? data : data instanceof ArrayBuffer ? Buffer.from(data).toString("utf8") : ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8") : data && typeof (data as Blob).text === "function" ? await (data as Blob).text() : undefined;
		if (!text || Buffer.byteLength(text) > MAX_UPSTREAM_MESSAGE_BYTES) throw new Error("Invalid Codex realtime WebSocket message");
		const message = JSON.parse(text) as unknown;
		if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid Codex realtime WebSocket payload");
		this.trace("websocket.receive", message);
		const record = message as Record<string, unknown>;
		if (record["type"] === "output_audio.delta" && typeof record["audio"] === "string") {
			this.onAudio(Buffer.from(record["audio"], "base64"));
		}
		this.emit({ type: "data", message });
		return typeof record["type"] === "string" ? record["type"] : undefined;
	}

	private emit(event: CodexRealtimePeerEvent): void {
		if (this.closed) return;
		for (const listener of this.eventListeners) listener(event);
	}

	private fail(error: Error): void {
		if (this.closed) return;
		this.closed = true;
		this.trace("websocket.error", error);
		const socket = this.socket;
		this.socket = undefined;
		if (socket) closeWebSocketSilently(socket, 1000, "failed");
		for (const listener of this.exitListeners) listener(error);
	}
}

function realtimeWebSocketUrl(baseUrl: string): string {
	const url = new URL(baseUrl);
	url.protocol = url.protocol === "http:" ? "ws:" : "wss:";
	const path = url.pathname.replace(/\/+$/, "");
	if (!path || path === "/v1") url.pathname = "/v1/live";
	else if (path.endsWith("/realtime")) url.pathname = `${path.slice(0, -"/realtime".length)}/live`;
	url.searchParams.set("model", V3_MODEL);
	return url.toString();
}

function traceHeaders(headers: Headers): Record<string, string> {
	const values = Object.fromEntries(headers);
	const authorization = values["authorization"];
	if (authorization) values["authorization"] = `<present:${authorization.length}>`;
	return values;
}
