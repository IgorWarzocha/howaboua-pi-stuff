import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";
import type { LanVoiceDraftSelection } from "./draft.ts";
import { decodeLanVoiceAudioCommand } from "./protocol.ts";

export const MAX_CONTROL_BYTES = 72 * 1024;
const MAX_PCM_BYTES = 24_000 * 2;

type LanVoiceBrowserMode = "conversation" | "dictation";
type LanVoiceBrowserState =
	| { type: "idle" }
	| { type: "active"; clientId: string; socket: WebSocket; mode: LanVoiceBrowserMode }
	| { type: "closed" };

interface LanVoiceBrowserClientsOptions {
	ensureConversation(): Promise<void>;
	startDictation(clientId: string): Promise<void>;
	finishDictation(clientId: string, draft?: string, revision?: number, selection?: LanVoiceDraftSelection): Promise<void>;
	cancelDictation(clientId: string): Promise<void>;
	onConversationActivity(active: boolean): void;
	onConversationAudio(pcm: Buffer): void;
	onDictationAudio(clientId: string, pcm: Buffer): void;
}

export class LanVoiceBrowserClients {
	private readonly options: LanVoiceBrowserClientsOptions;
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private state: LanVoiceBrowserState = { type: "idle" };
	private operation = Promise.resolve();

	constructor(options: LanVoiceBrowserClientsOptions) {
		this.options = options;
	}

	connectEvents(clientId: string, response: ServerResponse): void {
		if (this.state.type === "closed") { response.end(); return; }
		const previous = this.eventResponses.get(clientId);
		this.eventResponses.set(clientId, response);
		previous?.end();
		response.once("close", () => {
			if (this.eventResponses.get(clientId) === response) this.eventResponses.delete(clientId);
		});
	}

	connectAudio(clientId: string, socket: WebSocket): void {
		if (this.state.type === "closed") { socket.close(1012, "server closing"); return; }
		const previous = this.audioSockets.get(clientId);
		this.audioSockets.set(clientId, socket);
		previous?.close(4001, "replaced");
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", (data, isBinary) => this.receive(clientId, socket, data, isBinary));
		socket.once("close", () => {
			if (this.audioSockets.get(clientId) === socket) this.audioSockets.delete(clientId);
			this.release(clientId, socket);
		});
	}

	sendConversationAudio(pcm: Buffer): void {
		const active = this.state;
		if (active.type !== "active" || active.mode !== "conversation" || active.socket.readyState !== WebSocket.OPEN) return;
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
			const active = this.state;
			if (active.type !== "active" || active.clientId !== clientId || (socket && active.socket !== socket)) return;
			this.state = { type: "idle" };
			if (active.mode === "conversation") this.options.onConversationActivity(false);
			if (active.mode === "dictation") await this.options.finishDictation(clientId);
		}).catch((error: unknown) => {
			this.sendControl(clientId, { type: "error", message: error instanceof Error ? error.message : String(error) });
		});
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values()) if (!response.writableEnded) response.write(": keepalive\n\n");
	}

	async close(): Promise<void> {
		const active = this.state;
		if (active.type === "closed") { await this.operation; return; }
		this.state = { type: "closed" };
		if (active.type === "active" && active.mode === "conversation") this.options.onConversationActivity(false);
		for (const socket of this.audioSockets.values()) socket.terminate();
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) response.end();
		this.eventResponses.clear();
		await this.operation;
	}

	private receive(clientId: string, socket: WebSocket, data: RawData, isBinary: boolean): void {
		if (this.audioSockets.get(clientId) !== socket) return;
		try {
			if (isBinary) { this.receiveAudio(clientId, socket, rawBuffer(data)); return; }
			const text = rawBuffer(data).toString("utf8");
			if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error("LAN voice control message is too large");
			const message = decodeLanVoiceAudioCommand(JSON.parse(text));
			if (message.type === "start") {
				void this.claim(clientId, socket, message.mode).catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "finish") {
				void this.finish(clientId, socket, message.draft, message.revision, message.selection).catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "release") {
				this.release(clientId, socket);
			} else {
				void this.options.cancelDictation(clientId).catch((error: unknown) => this.sendSocketError(socket, error));
			}
		} catch (error) {
			socket.close(1003, "invalid message");
		}
	}

	private receiveAudio(clientId: string, socket: WebSocket, pcm: Buffer): void {
		if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES || pcm.byteLength % 2 !== 0) throw new Error("Invalid LAN voice PCM frame");
		const active = this.state;
		if (active.type !== "active" || active.clientId !== clientId || active.socket !== socket) return;
		if (active.mode === "conversation") this.options.onConversationAudio(pcm);
		else this.options.onDictationAudio(clientId, pcm);
	}

	private claim(clientId: string, socket: WebSocket, mode: LanVoiceBrowserMode): Promise<void> {
		return this.enqueue(async () => {
			if (this.isClosed()) return;
			const previous = this.state.type === "active" ? this.state : undefined;
			if (previous?.clientId === clientId && previous.socket === socket && previous.mode === mode) return;
			this.state = { type: "idle" };
			if (previous && previous.socket !== socket) {
				this.sendControl(previous.clientId, { type: "stop", reason: "replaced" });
				previous.socket.close(4001, "replaced");
			}
			if (previous?.mode === "conversation" && mode !== "conversation") this.options.onConversationActivity(false);
			if (previous?.mode === "dictation") await this.options.finishDictation(previous.clientId);
			if (this.isClosed()) return;
			if (mode === "conversation") await this.options.ensureConversation();
			else await this.options.startDictation(clientId);
			if (this.isClosed()) {
				if (mode === "dictation") await this.options.cancelDictation(clientId);
				return;
			}
			this.state = { type: "active", clientId, socket, mode };
			if (previous?.mode !== "conversation" && mode === "conversation") this.options.onConversationActivity(true);
			socket.send(JSON.stringify({ type: "active", mode }));
		});
	}

	private finish(clientId: string, socket: WebSocket, draft: string, revision: number, selection: LanVoiceDraftSelection): Promise<void> {
		return this.enqueue(async () => {
			const active = this.state;
			if (active.type !== "active" || active.clientId !== clientId || active.socket !== socket || active.mode !== "dictation") return;
			this.state = { type: "idle" };
			await this.options.finishDictation(clientId, draft, revision, selection);
			if (!this.isClosed() && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "dictation.complete" }));
		});
	}

	private sendSocketError(socket: WebSocket, error: unknown): void {
		const message = error instanceof Error ? error.message : String(error);
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message }));
	}

	private isClosed(): boolean {
		return this.state.type === "closed";
	}

	private enqueue<T>(action: () => Promise<T>): Promise<T> {
		const result = this.operation.then(action, action);
		this.operation = result.then(() => undefined, () => undefined);
		return result;
	}
}

function rawBuffer(data: RawData): Buffer {
	if (Buffer.isBuffer(data)) return data;
	if (Array.isArray(data)) return Buffer.concat(data);
	return Buffer.from(data);
}
