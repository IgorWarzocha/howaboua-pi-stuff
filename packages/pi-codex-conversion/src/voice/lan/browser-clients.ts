import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";
import { MAX_REALTIME_SDP_BYTES } from "../conversation/peer.ts";
import { LanBrowserRealtimePeer } from "./browser-peer.ts";
import type { LanVoiceDraftSelection } from "./draft.ts";
import { decodeLanVoiceAudioCommand } from "./protocol.ts";

export const MAX_CONTROL_BYTES = MAX_REALTIME_SDP_BYTES + 16 * 1024;
const MAX_PCM_BYTES = 24_000 * 2;

type LanVoiceBrowserMode = "conversation" | "dictation";
type LanVoiceBrowserState =
	| { type: "idle" }
	| { type: "starting"; clientId: string; socket: WebSocket; mode: "conversation"; peer: LanBrowserRealtimePeer }
	| { type: "active"; clientId: string; socket: WebSocket; mode: "conversation"; peer: LanBrowserRealtimePeer }
	| { type: "active"; clientId: string; socket: WebSocket; mode: "dictation" }
	| { type: "closed" };

interface LanVoiceBrowserClientsOptions {
	startConversation(peer: LanBrowserRealtimePeer): Promise<void>;
	cancelConversationStart(peer: LanBrowserRealtimePeer): void;
	stopConversation(peer: LanBrowserRealtimePeer): Promise<void>;
	startDictation(clientId: string): Promise<void>;
	finishDictation(clientId: string, draft?: string, revision?: number, selection?: LanVoiceDraftSelection): Promise<void>;
	cancelDictation(clientId: string): Promise<void>;
	onConversationActivity(active: boolean): void;
	onConversationMute(muted: boolean): void;
	onDictationAudio(clientId: string, pcm: Buffer): void;
}

export class LanVoiceBrowserClients {
	private readonly options: LanVoiceBrowserClientsOptions;
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private readonly conversationPeers = new WeakMap<WebSocket, LanBrowserRealtimePeer>();
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
		if (previous) this.cancelStartingConversation(clientId, previous);
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

	release(clientId: string, socket?: WebSocket): void {
		this.cancelStartingConversation(clientId, socket);
		void this.enqueue(async () => {
			const active = this.state;
			if (active.type !== "active" || active.clientId !== clientId || (socket && active.socket !== socket)) return;
			this.state = { type: "idle" };
			if (active.mode === "conversation") {
				this.conversationPeers.delete(active.socket);
				this.options.onConversationActivity(false);
				await this.options.stopConversation(active.peer);
			}
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
		const failures: unknown[] = [];
		if (active.type === "starting") {
			this.conversationPeers.delete(active.socket);
			try { this.options.cancelConversationStart(active.peer); } catch (error) { failures.push(error); }
		}
		if (active.type === "active" && active.mode === "conversation") {
			try { this.options.onConversationActivity(false); } catch (error) { failures.push(error); }
			this.conversationPeers.delete(active.socket);
			try { await this.options.stopConversation(active.peer); } catch (error) { failures.push(error); }
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
				void this.claim(clientId, socket, message.mode, message.type === "start" && message.mode === "conversation" ? message.sdp : undefined).catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "finish") {
				void this.finish(clientId, socket, message.draft, message.revision, message.selection).catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "release") {
				this.release(clientId, socket);
			} else if (message.type === "mute") {
				this.mute(clientId, socket, message.muted);
			} else if (message.type === "peer_state" || message.type === "peer_data" || message.type === "peer_error") {
				this.conversationPeers.get(socket)?.receive(message);
			} else {
				void this.options.cancelDictation(clientId).catch((error: unknown) => this.sendSocketError(socket, error));
			}
		} catch (error) {
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
		if (active.mode === "dictation") this.options.onDictationAudio(clientId, pcm);
	}

	private claim(clientId: string, socket: WebSocket, mode: LanVoiceBrowserMode, offerSdp?: string): Promise<void> {
		const starting = this.state.type === "starting" ? this.state : undefined;
		if (starting && (starting.clientId !== clientId || starting.socket !== socket || starting.mode !== mode)) {
			this.cancelStartingConversation(starting.clientId, starting.socket);
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
			if (previous?.mode === "conversation" && mode === "conversation") this.options.onConversationMute(false);
			if (previous?.mode === "conversation") {
				this.options.onConversationActivity(false);
				this.conversationPeers.delete(previous.socket);
				await this.options.stopConversation(previous.peer);
			}
			if (previous?.mode === "dictation") await this.options.finishDictation(previous.clientId);
			if (this.isClosed()) return;
			let peer: LanBrowserRealtimePeer | undefined;
			if (mode === "conversation") {
				if (!offerSdp) throw new Error("LAN realtime start requires an SDP offer");
				peer = new LanBrowserRealtimePeer(offerSdp, (value) => {
					if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
				});
				this.conversationPeers.set(socket, peer);
				const starting = { type: "starting", clientId, socket, mode, peer } as const;
				this.state = starting;
				try {
					await this.options.startConversation(peer);
				} catch (error) {
					const cancelled = this.state !== starting;
					if (!cancelled) this.state = { type: "idle" };
					this.conversationPeers.delete(socket);
					if (cancelled) return;
					throw error;
				}
				peer.markActive();
			} else await this.options.startDictation(clientId);
			if (this.isClosed() || (peer && (this.state.type !== "starting" || this.state.peer !== peer)) || this.audioSockets.get(clientId) !== socket || socket.readyState !== WebSocket.OPEN) {
				if (peer) {
					this.conversationPeers.delete(socket);
					await this.options.stopConversation(peer);
				}
				if (mode === "dictation") await this.options.cancelDictation(clientId);
				return;
			}
			this.state = mode === "conversation"
				? { type: "active", clientId, socket, mode, peer: peer! }
				: { type: "active", clientId, socket, mode };
			if (mode === "conversation") this.options.onConversationActivity(true);
			socket.send(JSON.stringify({ type: "active", mode }));
		});
	}

	private cancelStartingConversation(clientId: string, socket?: WebSocket): void {
		const starting = this.state;
		if (starting.type !== "starting" || starting.clientId !== clientId || (socket && starting.socket !== socket)) return;
		this.state = { type: "idle" };
		this.conversationPeers.delete(starting.socket);
		try { this.options.cancelConversationStart(starting.peer); } catch (error) {
			this.sendControl(clientId, { type: "error", message: error instanceof Error ? error.message : String(error) });
		}
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
