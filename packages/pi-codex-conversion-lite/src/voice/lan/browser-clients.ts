import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";

const MAX_CONTROL_BYTES = 8 * 1024;
export const MAX_PCM_BYTES = 24_000 * 2;

export class LanVoiceBrowserClients {
	private readonly diagnostics: LanVoiceDiagnostics;
	private readonly ensureConversation: () => Promise<void>;
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private activeClientId: string | undefined;
	private activeSocket: WebSocket | undefined;
	private operation = Promise.resolve();

	constructor(options: {
		diagnostics: LanVoiceDiagnostics;
		ensureConversation(): Promise<void>;
		onAudio(pcm: Buffer): void;
	}) {
		this.diagnostics = options.diagnostics;
		this.ensureConversation = options.ensureConversation;
		this.onAudio = options.onAudio;
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
		this.diagnostics.write("server", "audio.connected", { clientId });
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", (data, isBinary) => this.receive(clientId, socket, data, isBinary));
		socket.once("close", (code, reason) => {
			this.diagnostics.write("server", "audio.closed", { clientId, code, reason: reason.toString() });
			if (this.audioSockets.get(clientId) === socket) this.audioSockets.delete(clientId);
			this.release(clientId, socket);
		});
	}

	sendAudio(pcm: Buffer): void {
		if (!this.activeSocket || this.activeSocket.readyState !== WebSocket.OPEN) return;
		this.diagnostics.write("server", "audio.out", { clientId: this.activeClientId, bytes: pcm.byteLength });
		this.activeSocket.send(pcm, { binary: true });
	}

	release(clientId: string, socket?: WebSocket): void {
		if (this.activeClientId !== clientId || (socket && this.activeSocket !== socket)) return;
		this.diagnostics.write("server", "audio.release", { clientId });
		this.activeClientId = undefined;
		this.activeSocket = undefined;
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values()) if (!response.writableEnded) response.write(": keepalive\n\n");
	}

	close(): void {
		this.activeClientId = undefined;
		this.activeSocket = undefined;
		for (const socket of this.audioSockets.values()) socket.terminate();
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) response.end();
		this.eventResponses.clear();
	}

	private receive(clientId: string, socket: WebSocket, data: RawData, isBinary: boolean): void {
		try {
			if (isBinary) {
				const pcm = rawBuffer(data);
				if (pcm.byteLength === 0 || pcm.byteLength > MAX_PCM_BYTES || pcm.byteLength % 2 !== 0) throw new Error("Invalid LAN voice PCM frame");
				if (this.activeClientId !== clientId || this.activeSocket !== socket) return;
				this.diagnostics.write("server", "audio.in", { clientId, bytes: pcm.byteLength });
				this.onAudio(pcm);
				return;
			}
			const text = rawBuffer(data).toString("utf8");
			if (Buffer.byteLength(text) > MAX_CONTROL_BYTES) throw new Error("LAN voice control message is too large");
			const message = JSON.parse(text) as { type?: unknown };
			if (message.type === "start") void this.claim(clientId, socket).catch((error: unknown) => {
				const message = error instanceof Error ? error.message : String(error);
				this.diagnostics.write("server", "audio.start_error", { clientId, message });
				if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "error", message }));
			});
			else if (message.type === "release") this.release(clientId, socket);
		} catch (error) {
			this.diagnostics.write("server", "audio.message_error", { clientId, error });
			socket.close(1003, "invalid message");
		}
	}

	private claim(clientId: string, socket: WebSocket): Promise<void> {
		return this.enqueue(async () => {
			await this.ensureConversation();
			const previousId = this.activeClientId;
			const previousSocket = this.activeSocket;
			this.activeClientId = clientId;
			this.activeSocket = socket;
			if (previousSocket && previousSocket !== socket) {
				if (previousId) this.sendControl(previousId, { type: "stop", reason: "replaced" });
				previousSocket.close(4001, "replaced");
			}
			this.diagnostics.write("server", "audio.claim", { clientId, previousClientId: previousId });
			socket.send(JSON.stringify({ type: "active" }));
		});
	}

	private sendControl(clientId: string, value: unknown): void {
		const response = this.eventResponses.get(clientId);
		if (response && !response.writableEnded) response.write(`data: ${JSON.stringify(value)}\n\n`);
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
