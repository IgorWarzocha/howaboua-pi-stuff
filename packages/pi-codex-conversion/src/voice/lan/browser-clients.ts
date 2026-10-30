import type { ServerResponse } from "node:http";
import { type RawData, WebSocket } from "ws";
import { LanVoiceBrowserConnections } from "./browser-connections.ts";
import {
	type LanVoiceBrowserClientsOptions,
	LanVoiceBrowserSession,
} from "./browser-session.ts";
import { decodeLanVoiceBrowserInput, errorMessage } from "./browser-wire.ts";

export { MAX_CONTROL_BYTES } from "./browser-wire.ts";

export class LanVoiceBrowserClients {
	private readonly connections = new LanVoiceBrowserConnections();
	private readonly session: LanVoiceBrowserSession;
	private readonly takeoverToken: string | undefined;
	private takeoverAck:
		| { token: string; socket: WebSocket; resolve(): void }
		| undefined;

	constructor(options: LanVoiceBrowserClientsOptions, takeoverToken?: string) {
		this.session = new LanVoiceBrowserSession(options, this.connections);
		this.takeoverToken = takeoverToken;
	}

	connectEvents(clientId: string, response: ServerResponse): void {
		this.connections.connectEvents(clientId, response, this.session.closed);
		if (this.takeoverToken)
			this.connections.sendControl(clientId, {
				type: "ready",
				takeoverToken: this.takeoverToken,
			});
	}

	browserAttached(): boolean {
		return this.connections.hasAudioClients();
	}

	takeover(token: string): Promise<void> {
		const socket = this.session.conversationSocket;
		if (!socket || socket.readyState !== WebSocket.OPEN) {
			this.connections.broadcastTakeover(token);
			return Promise.resolve();
		}
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.takeoverAck = undefined;
				reject(
					new Error(
						"Browser did not acknowledge LAN takeover; source remains active",
					),
				);
			}, 5_000);
			const finish = () => {
				clearTimeout(timer);
				this.takeoverAck = undefined;
				resolve();
			};
			this.takeoverAck = { token, socket, resolve: finish };
			this.connections.broadcastTakeover(token);
		});
	}

	connectAudio(clientId: string, socket: WebSocket): void {
		this.connections.connectAudio(clientId, socket, this.session.closed, {
			onMessage: (data, isBinary) =>
				this.receive(clientId, socket, data, isBinary),
			onReplaced: (previous) =>
				this.session.releaseStarting(clientId, previous),
			onClose: () => this.session.release(clientId, socket),
		});
	}

	sendControl(clientId: string, value: unknown): void {
		this.connections.sendControl(clientId, value);
	}

	broadcastControl(value: unknown): void {
		this.connections.broadcastControl(value);
	}

	sendConversationAudio(pcm: Buffer): void {
		this.session.sendConversationAudio(pcm);
	}

	setConversationSpeakerSuppressed(suppressed: boolean): void {
		this.session.setConversationSpeakerSuppressed(suppressed);
	}

	resetConversationInputLevel(): void {
		this.session.resetConversationInputLevel();
	}

	release(
		clientId: string,
		socket?: WebSocket,
		terminateConversation = false,
	): void {
		this.session.release(clientId, socket, terminateConversation);
	}

	heartbeat(): void {
		this.connections.heartbeat();
	}

	async close(): Promise<void> {
		await this.session.close();
	}

	private receive(
		clientId: string,
		socket: WebSocket,
		data: RawData,
		isBinary: boolean,
	): void {
		if (!this.connections.isCurrentAudio(clientId, socket)) return;
		try {
			if (!isBinary && this.takeoverAck) {
				const value: unknown = JSON.parse(data.toString());
				if (
					value &&
					typeof value === "object" &&
					"type" in value &&
					value.type === "takeover.ack" &&
					"token" in value &&
					value.token === this.takeoverAck.token &&
					this.takeoverAck.socket === socket
				) {
					this.takeoverAck.resolve();
					return;
				}
			}
			const input = decodeLanVoiceBrowserInput(data, isBinary);
			if (input.type === "audio") {
				this.session.receiveAudio(clientId, socket, input.pcm);
				return;
			}
			const message = input.command;
			if (message.type === "start") {
				void this.session
					.claim(clientId, socket, message.mode, message.takeoverToken)
					.catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "finish") {
				void this.session
					.finish(
						clientId,
						socket,
						message.draft,
						message.revision,
						message.selection,
					)
					.catch((error: unknown) => this.sendSocketError(socket, error));
			} else if (message.type === "release") {
				this.session.release(clientId, socket, true);
			} else if (message.type === "mute") {
				this.session.mute(clientId, socket, message.muted);
			} else {
				void this.session
					.cancelDictation(clientId)
					.catch((error: unknown) => this.sendSocketError(socket, error));
			}
		} catch {
			socket.close(1003, "invalid message");
		}
	}

	private sendSocketError(socket: WebSocket, error: unknown): void {
		if (socket.readyState === WebSocket.OPEN)
			socket.send(
				JSON.stringify({ type: "error", message: errorMessage(error) }),
			);
	}
}
