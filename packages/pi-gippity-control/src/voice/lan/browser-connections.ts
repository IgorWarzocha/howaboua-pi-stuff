import type { ServerResponse } from "node:http";
import { type RawData, WebSocket } from "ws";
import {
	type NativePlaybackDiagnostics,
	nativePlaybackDiagnostics,
} from "./native-audio-diagnostics.ts";

const MAX_SOCKET_AUDIO_BACKLOG = 24_000 * 2;
const AUDIO_REPORT_INTERVAL_MS = 5_000;

export type LanPlaybackDiagnostics =
	| LanSourcePlaybackDiagnostics
	| NativePlaybackDiagnostics;

interface LanSourcePlaybackDiagnostics {
	source: "lan-playback";
	clientId: string;
	hostUnixMs: number;
	reason: "interval" | "closed" | "replaced" | "server-closed";
	windowMs: number;
	sentFrames: number;
	sentBytes: number;
	droppedFrames: number;
	droppedBytes: number;
	maxSocketBacklogBytes: number;
	// Observed sendAudio entry timing, not network jitter; includes normal pauses.
	sourcePcmArrivalGapMaxMs: number;
	sourcePcmArrivalGapIncludesPauses: true;
}

interface AudioReportState {
	startedAt: number;
	lastArrivalAt: number;
	sentFrames: number;
	sentBytes: number;
	droppedFrames: number;
	droppedBytes: number;
	maxSocketBacklogBytes: number;
	sourcePcmArrivalGapMaxMs: number;
	timer?: ReturnType<typeof setTimeout> | undefined;
}

interface AudioConnectionCallbacks {
	onMessage(data: RawData, isBinary: boolean): void;
	onReplaced(previous: WebSocket): void;
	onClose(): void;
}

export class LanVoiceBrowserConnections {
	private readonly eventResponses = new Map<string, ServerResponse>();
	private readonly audioSockets = new Map<string, WebSocket>();
	private readonly audioReports = new WeakMap<WebSocket, AudioReportState>();
	private readonly clientIds = new WeakMap<WebSocket, string>();

	private readonly onAudioDiagnostics:
		| ((report: LanPlaybackDiagnostics) => void)
		| undefined;

	constructor(onAudioDiagnostics?: (report: LanPlaybackDiagnostics) => void) {
		this.onAudioDiagnostics = onAudioDiagnostics;
	}

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
		this.clientIds.set(socket, clientId);
		this.audioSockets.set(clientId, socket);
		if (previous) {
			this.finishAudioReport(previous, "replaced");
			callbacks.onReplaced(previous);
		}
		previous?.close(4001, "replaced");
		socket.send(
			JSON.stringify({ type: "connected", nativeAudioDiagnostics: 1 }),
		);
		let lastNativeReport = -Infinity;
		socket.on("message", (data, isBinary) => {
			if (!isBinary) {
				const text = data.toString();
				if (text.length <= 8192) {
					let value: unknown;
					try {
						value = JSON.parse(text);
					} catch {
						/* Existing wire handler owns invalid JSON. */
					}
					if (
						value &&
						typeof value === "object" &&
						"type" in value &&
						value.type === "native_audio_diagnostics"
					) {
						if (
							!this.isCurrentAudio(clientId, socket) ||
							performance.now() - lastNativeReport < 500
						)
							return;
						lastNativeReport = performance.now();
						const report = nativePlaybackDiagnostics(
							value as Record<string, unknown>,
							clientId,
						);
						if (report) {
							try {
								this.onAudioDiagnostics?.(report);
							} catch {
								console.warn(
									"[voice audio] Native playback diagnostics could not be saved",
								);
							}
							this.sendAudioControl(socket, {
								type: "native_audio_diagnostics_ack",
								hostUnixMs: report.hostUnixMs,
								probeId: report.client["probe_id"],
							});
						}
						return;
					}
				}
			}
			callbacks.onMessage(data, isBinary);
		});
		socket.once("close", () => {
			this.finishAudioReport(socket, "closed");
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
		const now = performance.now();
		const report = this.audioReports.get(socket) ?? {
			startedAt: now,
			lastArrivalAt: now,
			sentFrames: 0,
			sentBytes: 0,
			droppedFrames: 0,
			droppedBytes: 0,
			maxSocketBacklogBytes: 0,
			sourcePcmArrivalGapMaxMs: 0,
		};
		this.audioReports.set(socket, report);
		report.sourcePcmArrivalGapMaxMs = Math.max(
			report.sourcePcmArrivalGapMaxMs,
			now - report.lastArrivalAt,
		);
		report.lastArrivalAt = now;
		report.maxSocketBacklogBytes = Math.max(
			report.maxSocketBacklogBytes,
			socket.bufferedAmount,
		);
		if (socket.bufferedAmount < MAX_SOCKET_AUDIO_BACKLOG) {
			socket.send(pcm);
			report.maxSocketBacklogBytes = Math.max(
				report.maxSocketBacklogBytes,
				socket.bufferedAmount,
			);
			report.sentFrames++;
			report.sentBytes += pcm.byteLength;
		} else {
			report.droppedFrames++;
			report.droppedBytes += pcm.byteLength;
		}
		if (!report.timer) {
			report.startedAt = now;
			report.timer = setTimeout(
				() => this.flushAudioReport(socket, "interval"),
				AUDIO_REPORT_INTERVAL_MS,
			);
			report.timer.unref();
		}
	}

	private flushAudioReport(
		socket: WebSocket,
		reason: LanSourcePlaybackDiagnostics["reason"],
	): void {
		const report = this.audioReports.get(socket);
		if (!report) return;
		clearTimeout(report.timer);
		report.timer = undefined;
		if (report.sentFrames + report.droppedFrames === 0) return;
		const diagnostics: LanPlaybackDiagnostics = {
			source: "lan-playback",
			clientId: this.clientIds.get(socket) ?? "unknown",
			hostUnixMs: Date.now(),
			reason,
			windowMs: performance.now() - report.startedAt,
			sentFrames: report.sentFrames,
			sentBytes: report.sentBytes,
			droppedFrames: report.droppedFrames,
			droppedBytes: report.droppedBytes,
			maxSocketBacklogBytes: report.maxSocketBacklogBytes,
			sourcePcmArrivalGapMaxMs: report.sourcePcmArrivalGapMaxMs,
			sourcePcmArrivalGapIncludesPauses: true,
		};
		report.sentFrames =
			report.sentBytes =
			report.droppedFrames =
			report.droppedBytes =
				0;
		report.maxSocketBacklogBytes = report.sourcePcmArrivalGapMaxMs = 0;
		// Persistence failures must not change playback or socket cleanup.
		try {
			this.onAudioDiagnostics?.(diagnostics);
		} catch {
			console.warn("[voice audio] LAN playback diagnostics could not be saved");
		}
	}

	private finishAudioReport(
		socket: WebSocket,
		reason: LanSourcePlaybackDiagnostics["reason"],
	): void {
		this.flushAudioReport(socket, reason);
		this.audioReports.delete(socket);
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
			this.finishAudioReport(socket, "server-closed");
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
