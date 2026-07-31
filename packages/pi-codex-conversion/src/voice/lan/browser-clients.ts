import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";
import type { LanVoiceDraftSelection } from "./draft.ts";
import { decodeLanVoiceAudioCommand } from "./protocol.ts";

export const MAX_CONTROL_BYTES = 64 * 1024;
const MAX_PCM_BYTES = 24_000 * 2;
const MAX_SOCKET_AUDIO_BACKLOG = 24_000 * 2;

type LanVoiceBrowserMode = "conversation" | "dictation";
type LanVoiceBrowserState =
	| { type: "idle" }
	| { type: "starting"; clientId: string; socket: WebSocket; mode: LanVoiceBrowserMode }
	| { type: "active"; clientId: string; socket: WebSocket; mode: LanVoiceBrowserMode }
	| { type: "closed" };

interface LanVoiceBrowserClientsOptions {
	ensureConversation(): Promise<void>;
	startDictation(clientId: string): Promise<void>;
	finishDictation(clientId: string, draft?: string, revision?: number, selection?: LanVoiceDraftSelection): Promise<void>;
	cancelDictation(clientId: string): Promise<void>;
	onConversationActivity(active: boolean): void;
	onConversationMute(muted: boolean): void;
	conversationMuted(): boolean;
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
		if (previous) this.releaseStarting(clientId, previous);
		previous?.close(4001, "replaced");
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", (data, isBinary) => this.receive(clientId, socket, data, isBinary));
		socket.once("close", () => {
			if (this.audioSockets.get(clientId) === socket) this.audioSockets.delete(clientId);
			this.release(clientId, socket);
		});
	}

	sendControl(clientId: string, value: unknown): void {
		const response = this.eventResponses.get(clientId);
		if (response && !response.writableEnded) response.write(`data: ${JSON.stringify(value)}\n\n`);
	}

	broadcastControl(value: unknown): void {
		for (const clientId of this.eventResponses.keys()) this.sendControl(clientId, value);
	}

	sendConversationAudio(pcm: Buffer): void {
		const active = this.state;
		if (active.type !== "active" || active.mode !== "conversation") return;
		if (active.socket.readyState !== WebSocket.OPEN || active.socket.bufferedAmount >= MAX_SOCKET_AUDIO_BACKLOG) return;
		active.socket.send(pcm);
	}

	release(clientId: string, socket?: WebSocket): void {
		this.releaseStarting(clientId, socket);
		void this.enqueue(async () => {
			const active = this.state;
			if (active.type !== "active" || active.clientId !== clientId || (socket && active.socket !== socket)) return;
			this.state = { type: "idle" };
			if (active.mode === "conversation") this.options.onConversationActivity(false);
			else await this.options.finishDictation(clientId);
		}).catch((error: unknown) => this.sendControl(clientId, { type: "error", message: errorMessage(error) }));
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values()) if (!response.writableEnded) response.write(": keepalive\n\n");
	}

	async close(): Promise<void> {
		const active = this.state;
		if (active.type === "closed") { await this.operation; return; }
		this.state = { type: "closed" };
		const failures: unknown[] = [];
		if (active.type === "active" && active.mode === "conversation") {
			try { this.options.onConversationActivity(false); } catch (error) { failures.push(error); }
		}
		if ((active.type === "starting" || active.type === "active") && active.mode === "dictation") {
			try { await this.options.cancelDictation(active.clientId); } catch (error) { failures.push(error); }
		}
		for (const socket of this.audioSockets.values()) {
			try { socket.terminate(); } catch (error) { failures.push(error); }
		}
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) {
			try { response.end(); } catch (error) { failures.push(error); }
		}
		this.eventResponses.clear();
		try { await this.operation; } catch (error) { failures.push(error); }
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1) throw new AggregateError(failures, "LAN browser cleanup failed");
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
			} else if (message.type === "mute") {
				this.mute(clientId, socket, message.muted);
			} else {
				void this.options.cancelDictation(clientId).catch((error: unknown) => this.sendSocketError(socket, error));
			}
		} catch {
			socket.close(1003, "invalid message");
		}
	}

	private mute(clientId: string, socket: WebSocket, muted: boolean): void {
		const active = this.state;
		if (active.type !== "active" || active.clientId !== clientId || active.socket !== socket || active.mode !== "conversation") return;
		this.options.onConversationMute(muted);
	}

	private receiveAudio(clientId: string, socket: WebSocket, pcm: Buffer): void {
		if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES || pcm.byteLength % 2 !== 0) throw new Error("Invalid LAN voice PCM frame");
		const active = this.state;
		if (active.type !== "active" || active.clientId !== clientId || active.socket !== socket) return;
		if (active.mode === "conversation") this.options.onConversationAudio(pcm);
		else this.options.onDictationAudio(clientId, pcm);
	}

	private claim(clientId: string, socket: WebSocket, mode: LanVoiceBrowserMode): Promise<void> {
		const starting = this.state.type === "starting" ? this.state : undefined;
		if (starting && (starting.clientId !== clientId || starting.socket !== socket || starting.mode !== mode)) {
			this.releaseStarting(starting.clientId, starting.socket);
			this.sendControl(starting.clientId, { type: "stop", reason: "replaced" });
			starting.socket.close(4001, "replaced");
		}
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
			const starting = { type: "starting", clientId, socket, mode } as const;
			this.state = starting;
			try {
				if (mode === "conversation") await this.options.ensureConversation();
				else await this.options.startDictation(clientId);
			} catch (error) {
				if (this.state === starting) this.state = { type: "idle" };
				throw error;
			}
			if (this.isClosed() || this.state !== starting || this.audioSockets.get(clientId) !== socket || socket.readyState !== WebSocket.OPEN) {
				if (mode === "dictation") await this.options.cancelDictation(clientId);
				return;
			}
			this.state = { type: "active", clientId, socket, mode };
			if (mode === "conversation") this.options.onConversationActivity(true);
			socket.send(JSON.stringify({ type: "active", mode, ...(mode === "conversation" ? { muted: this.options.conversationMuted() } : {}) }));
		});
	}

	private releaseStarting(clientId: string, socket?: WebSocket): void {
		const starting = this.state;
		if (starting.type !== "starting" || starting.clientId !== clientId || (socket && starting.socket !== socket)) return;
		this.state = { type: "idle" };
		if (starting.mode === "dictation") void this.options.cancelDictation(clientId).catch((error: unknown) => this.sendControl(clientId, { type: "error", message: errorMessage(error) }));
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
		if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message: errorMessage(error) }));
	}

	private isClosed(): boolean { return this.state.type === "closed"; }

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

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
