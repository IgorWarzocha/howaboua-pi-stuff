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
	private takeoverAck:
		| {
				token: string;
				socket: WebSocket;
				resolve(): void;
				reject(error: Error): void;
		  }
		| undefined;

	constructor(options: LanVoiceBrowserClientsOptions) {
		this.session = new LanVoiceBrowserSession(options, this.connections);
	}

	connectEvents(clientId: string, response: ServerResponse): void {
		this.connections.connectEvents(clientId, response, this.session.closed);
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

	hasEventClients(): boolean {
		return this.connections.hasEventClients();
	}

	hasAudioClients(): boolean {
		return this.connections.hasAudioClients();
	}

	broadcastControl(value: unknown): void {
		this.connections.broadcastControl(value);
	}

	takeover(token: string): Promise<void> {
		const socket = this.session.conversationSocket;
		if (!socket || socket.readyState !== WebSocket.OPEN)
			return Promise.reject(
				new Error("The active browser microphone is not connected"),
			);
		if (this.takeoverAck)
			return Promise.reject(
				new Error("A browser takeover is already preparing"),
			);
		return new Promise((resolve, reject) => {
			const finish = (error?: Error) => {
				clearTimeout(timeout);
				socket.removeListener("close", closed);
				this.takeoverAck = undefined;
				if (error) reject(error);
				else resolve();
			};
			const closed = () =>
				finish(
					new Error("The browser disconnected before acknowledging takeover"),
				);
			const timeout = setTimeout(
				() =>
					finish(
						new Error(
							"The browser did not acknowledge takeover; the source remains active",
						),
					),
				5_000,
			);
			this.takeoverAck = {
				token,
				socket,
				resolve: () => finish(),
				reject: finish,
			};
			socket.once("close", closed);
			this.connections.broadcastControl({ type: "takeover", token });
			socket.send(JSON.stringify({ type: "takeover", token }));
		});
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
		this.takeoverAck?.reject(new Error("LAN takeover cancelled"));
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
			const input = decodeLanVoiceBrowserInput(data, isBinary);
			if (input.type === "takeover.ack") {
				if (
					this.takeoverAck?.socket === socket &&
					this.takeoverAck.token === input.token
				)
					this.takeoverAck.resolve();
				return;
			}
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
