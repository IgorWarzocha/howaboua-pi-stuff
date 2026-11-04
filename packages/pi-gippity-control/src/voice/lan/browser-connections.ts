import type { ServerResponse } from "node:http";
import { type RawData, WebSocket } from "ws";

const MAX_SOCKET_AUDIO_BACKLOG = 24_000 * 2;
const AUDIO_DROP_REPORT_INTERVAL_MS = 5_000;

interface AudioConnectionCallbacks {
	onMessage(data: RawData, isBinary: boolean): void;
	onReplaced(previous: WebSocket): void;
	onClose(): void;
}

export class LanVoiceBrowserConnections {
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private readonly audioDrops = new WeakMap<
		WebSocket,
		{ reportedAt: number; frames: number; bytes: number; backlogBytes: number }
	>();

	connectEvents(
		clientId: string,
		response: ServerResponse,
		closed: boolean,
	): void {
		if (closed) {
			response.end();
			return;
		}
		const previous = this.eventResponses.get(clientId);
		this.eventResponses.set(clientId, response);
		previous?.end();
		response.once("close", () => {
			if (this.eventResponses.get(clientId) === response)
				this.eventResponses.delete(clientId);
		});
	}

	connectAudio(
		clientId: string,
		socket: WebSocket,
		closed: boolean,
		callbacks: AudioConnectionCallbacks,
	): void {
		if (closed) {
			socket.close(1012, "server closing");
			return;
		}
		const previous = this.audioSockets.get(clientId);
		this.audioSockets.set(clientId, socket);
		if (previous) callbacks.onReplaced(previous);
		previous?.close(4001, "replaced");
		socket.send(JSON.stringify({ type: "connected" }));
		socket.on("message", callbacks.onMessage);
		socket.once("close", () => {
			if (this.audioSockets.get(clientId) === socket)
				this.audioSockets.delete(clientId);
			callbacks.onClose();
		});
	}

	isCurrentAudio(clientId: string, socket: WebSocket): boolean {
		return this.audioSockets.get(clientId) === socket;
	}

	sendControl(clientId: string, value: unknown): void {
		const response = this.eventResponses.get(clientId);
		if (
			response &&
			!response.writableEnded &&
			!response.write(`data: ${JSON.stringify(value)}\n\n`)
		)
			response.end();
	}

	hasEventClients(): boolean {
		return this.eventResponses.size > 0;
	}

	hasAudioClients(): boolean {
		return [...this.audioSockets.values()].some(
			(socket) => socket.readyState === WebSocket.OPEN,
		);
	}

	broadcastControl(value: unknown): void {
		for (const clientId of this.eventResponses.keys())
			this.sendControl(clientId, value);
	}

	sendAudio(socket: WebSocket, pcm: Buffer): void {
		if (socket.readyState !== WebSocket.OPEN) return;
		if (socket.bufferedAmount < MAX_SOCKET_AUDIO_BACKLOG) socket.send(pcm);
		else {
			const drops = this.audioDrops.get(socket) ?? {
				reportedAt: -Infinity,
				frames: 0,
				bytes: 0,
				backlogBytes: 0,
			};
			drops.frames++;
			drops.bytes += pcm.byteLength;
			drops.backlogBytes = Math.max(drops.backlogBytes, socket.bufferedAmount);
			this.audioDrops.set(socket, drops);
		}
		const drops = this.audioDrops.get(socket);
		const now = performance.now();
		if (
			drops &&
			drops.frames > 0 &&
			now - drops.reportedAt >= AUDIO_DROP_REPORT_INTERVAL_MS
		) {
			// Keep the latency cap, but do not hide discontinuities it introduces.
			console.warn("[voice audio] LAN playback dropped PCM", {
				frames: drops.frames,
				bytes: drops.bytes,
				backlogBytes: drops.backlogBytes,
			});
			drops.reportedAt = now;
			drops.frames = drops.bytes = drops.backlogBytes = 0;
		}
	}

	sendAudioControl(socket: WebSocket, value: unknown): void {
		if (socket.readyState === WebSocket.OPEN)
			socket.send(JSON.stringify(value));
	}

	heartbeat(): void {
		for (const response of this.eventResponses.values())
			if (!response.writableEnded && !response.write(": keepalive\n\n"))
				response.end();
	}

	close(failures: unknown[]): void {
		for (const socket of this.audioSockets.values()) {
			try {
				socket.terminate();
			} catch (error) {
				failures.push(error);
			}
		}
		this.audioSockets.clear();
		for (const response of this.eventResponses.values()) {
			try {
				response.end();
			} catch (error) {
				failures.push(error);
			}
		}
		this.eventResponses.clear();
	}
}
