import type { ServerResponse } from "node:http";
import { WebSocket, type RawData } from "ws";

const MAX_SOCKET_AUDIO_BACKLOG = 24_000 * 2;

interface AudioConnectionCallbacks {
	onMessage(data: RawData, isBinary: boolean): void;
	onReplaced(previous: WebSocket): void;
	onClose(): void;
}

export class LanVoiceBrowserConnections {
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();

	connectEvents(clientId: string, response: ServerResponse, closed: boolean): void {
		if (closed) { response.end(); return; }
		const previous = this.eventResponses.get(clientId);
		this.eventResponses.set(clientId, response);
		previous?.end();
		response.once("close", () => {
			if (this.eventResponses.get(clientId) === response) this.eventResponses.delete(clientId);
		});
	}

	connectAudio(clientId: string, socket: WebSocket, closed: boolean, callbacks: AudioConnectionCallbacks): void {
		if (closed) { socket.close(1012, "server closing"); return; }
		const previous = this.audioSockets.get(clientId);
		this.audioSockets.set(clientId, socket);
		if (previous) callbacks.onReplaced(previous);
		previous?.close(4001, "replaced");
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", callbacks.onMessage);
		socket.once("close", () => {
			if (this.audioSockets.get(clientId) === socket) this.audioSockets.delete(clientId);
			callbacks.onClose();
		});
	}

	isCurrentAudio(clientId: string, socket: WebSocket): boolean {
		return this.audioSockets.get(clientId) === socket;
	}

	sendControl(clientId: string, value: unknown): void {
		const response = this.eventResponses.get(clientId);
		if (response && !response.writableEnded) response.write(`data: ${JSON.stringify(value)}\n\n`);
	}

	broadcastControl(value: unknown): void {
		for (const clientId of this.eventResponses.keys()) this.sendControl(clientId, value);
	}

	sendAudio(socket: WebSocket, pcm: Buffer): void {
		if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < MAX_SOCKET_AUDIO_BACKLOG) socket.send(pcm);
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values()) if (!response.writableEnded) response.write(": keepalive\n\n");
	}

	close(failures: unknown[]): void {
		for (const socket of this.audioSockets.values()) {
			try { socket.terminate(); } catch (error) { failures.push(error); }
		}
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) {
			try { response.end(); } catch (error) { failures.push(error); }
		}
		this.eventResponses.clear();
	}
}
