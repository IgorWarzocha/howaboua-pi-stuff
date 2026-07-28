import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";
import type { LanVoiceDraftSelection } from "./draft.ts";

const MAX_CONTROL_BYTES = 72 * 1024;
export const MAX_PCM_BYTES = 24_000 * 2;

type LanVoiceBrowserMode = "conversation" | "dictation";

interface LanVoiceBrowserClientsOptions {
	diagnostics: LanVoiceDiagnostics;
	ensureConversation(): Promise<void>;
	startDictation(clientId: string): Promise<void>;
	finishDictation(clientId: string, draft?: string, revision?: number, selection?: LanVoiceDraftSelection): Promise<void>;
	onConversationAudio(pcm: Buffer): void;
	onDictationAudio(clientId: string, pcm: Buffer): void;
}

export class LanVoiceBrowserClients {
	private readonly options: LanVoiceBrowserClientsOptions;
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private active: { clientId: string; socket: WebSocket; mode: LanVoiceBrowserMode } | undefined;
	private operation = Promise.resolve();

	constructor(options: LanVoiceBrowserClientsOptions) {
		this.options = options;
	}

	connectEvents(clientId: string, response: ServerResponse): void {
		const previous = this.eventResponses.get(clientId);
		this.eventResponses.set(clientId, response);
		previous?.end();
		response.once("close", () => {
			if (this.eventResponses.get(clientId) === response) this.eventResponses.delete(clientId);
		});
	}

	connectAudio(clientId: string, socket: WebSocket): void {
		const previous = this.audioSockets.get(clientId);
		this.audioSockets.set(clientId, socket);
		previous?.close(4001, "replaced");
		this.options.diagnostics.write("server", "audio.connected", { clientId });
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", (data, isBinary) => this.receive(clientId, socket, data, isBinary));
		socket.once("close", (code, reason) => {
			this.options.diagnostics.write("server", "audio.closed", { clientId, code, reason: reason.toString() });
			if (this.audioSockets.get(clientId) === socket) this.audioSockets.delete(clientId);
			this.release(clientId, socket);
		});
	}

	sendConversationAudio(pcm: Buffer): void {
		const active = this.active;
		if (!active || active.mode !== "conversation" || active.socket.readyState !== WebSocket.OPEN) return;
		this.options.diagnostics.write("server", "audio.out", { clientId: active.clientId, bytes: pcm.byteLength });
		active.socket.send(pcm, { binary: true });
	}

	sendControl(clientId: string, value: unknown): void {
		const response = this.eventResponses.get(clientId);
		if (response && !response.writableEnded) response.write(`data: ${JSON.stringify(value)}\n\n`);
	}

	broadcastControl(value: unknown): void {
		for (const clientId of this.eventResponses.keys()) this.sendControl(clientId, value);
	}

	release(clientId: string, socket?: WebSocket): void {
		void this.enqueue(async () => {
			const active = this.active;
			if (!active || active.clientId !== clientId || (socket && active.socket !== socket)) return;
			this.active = undefined;
			this.options.diagnostics.write("server", "audio.release", { clientId, mode: active.mode });
			if (active.mode === "dictation") await this.options.finishDictation(clientId);
		}).catch((error: unknown) => {
			this.options.diagnostics.write("server", "audio.release_error", { clientId, error });
			this.sendControl(clientId, { type: "error", message: error instanceof Error ? error.message : String(error) });
		});
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values()) if (!response.writableEnded) response.write(": keepalive\n\n");
	}

	close(): void {
		this.active = undefined;
		for (const socket of this.audioSockets.values()) socket.terminate();
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) response.end();
		this.eventResponses.clear();
	}

	private receive(clientId: string, socket: WebSocket, data: RawData, isBinary: boolean): void {
		try {
			if (isBinary) { this.receiveAudio(clientId, socket, rawBuffer(data)); return; }
			const text = rawBuffer(data).toString("utf8");
			if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error("LAN voice control message is too large");
			const message = JSON.parse(text) as Record<string, unknown>;
			if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error("Invalid LAN voice control message");
			if (message["type"] === "start") {
				const mode = message["mode"] === "dictation" ? "dictation" : "conversation";
				void this.claim(clientId, socket, mode).catch((error: unknown) => this.sendSocketError(clientId, socket, error));
			} else if (message["type"] === "finish") {
				const draft = typeof message["draft"] === "string" ? message["draft"] : undefined;
				const revision = typeof message["revision"] === "number" ? message["revision"] : undefined;
				const selection = draft === undefined ? undefined : parseSelection(message, draft.length);
				void this.finish(clientId, socket, draft, revision, selection).catch((error: unknown) => this.sendSocketError(clientId, socket, error));
			} else if (message["type"] === "release") {
				this.release(clientId, socket);
			}
		} catch (error) {
			this.options.diagnostics.write("server", "audio.message_error", { clientId, error });
			socket.close(1003, "invalid message");
		}
	}

	private receiveAudio(clientId: string, socket: WebSocket, pcm: Buffer): void {
		if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES || pcm.byteLength % 2 !== 0) throw new Error("Invalid LAN voice PCM frame");
		const active = this.active;
		if (!active || active.clientId !== clientId || active.socket !== socket) return;
		this.options.diagnostics.write("server", "audio.in", { clientId, mode: active.mode, bytes: pcm.byteLength });
		if (active.mode === "conversation") this.options.onConversationAudio(pcm);
		else this.options.onDictationAudio(clientId, pcm);
	}

	private claim(clientId: string, socket: WebSocket, mode: LanVoiceBrowserMode): Promise<void> {
		return this.enqueue(async () => {
			const previous = this.active;
			if (previous?.clientId === clientId && previous.socket === socket && previous.mode === mode) return;
			this.active = undefined;
			if (previous && previous.socket !== socket) {
				this.sendControl(previous.clientId, { type: "stop", reason: "replaced" });
				previous.socket.close(4001, "replaced");
			}
			if (previous?.mode === "dictation") await this.options.finishDictation(previous.clientId);
			if (mode === "conversation") await this.options.ensureConversation();
			else await this.options.startDictation(clientId);
			this.active = { clientId, socket, mode };
			this.options.diagnostics.write("server", "audio.claim", { clientId, mode, previousClientId: previous?.clientId });
			socket.send(JSON.stringify({ type: "active", mode }));
		});
	}

	private finish(clientId: string, socket: WebSocket, draft?: string, revision?: number, selection?: LanVoiceDraftSelection): Promise<void> {
		return this.enqueue(async () => {
			const active = this.active;
			if (!active || active.clientId !== clientId || active.socket !== socket || active.mode !== "dictation") return;
			this.active = undefined;
			await this.options.finishDictation(clientId, draft, revision, selection);
			if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "dictation.complete" }));
		});
	}

	private sendSocketError(clientId: string, socket: WebSocket, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		this.options.diagnostics.write("server", "audio.start_error", { clientId, message });
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message }));
	}

	private enqueue<T>(action: () => Promise<T>): Promise<T> {
		const result = this.operation.then(action, action);
		this.operation = result.then(() => undefined, () => undefined);
		return result;
	}
}

function parseSelection(message: Record<string, unknown>, draftLength: number): LanVoiceDraftSelection | undefined {
	const start = message["selectionStart"];
	const end = message["selectionEnd"];
	if (!Number.isInteger(start) || !Number.isInteger(end)) return undefined;
	if (typeof start !== "number" || typeof end !== "number" || start < 0 || end < 0 || start > draftLength || end > draftLength) return undefined;
	return { start, end };
}

function rawBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data);
}
