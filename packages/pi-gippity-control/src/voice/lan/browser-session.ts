import { WebSocket } from "ws";
import { LanVoiceBrowserConnections } from "./browser-connections.ts";
import { errorMessage } from "./browser-wire.ts";
import type { LanVoiceDraftSelection } from "./draft.ts";
import { MicrophoneLevelMonitor } from "./microphone-level.ts";

export type LanVoiceBrowserMode = "conversation" | "dictation";

type LanVoiceBrowserState =
	| { type: "idle" }
	| {
			type: "starting";
			clientId: string;
			socket: WebSocket;
			mode: LanVoiceBrowserMode;
	  }
	| {
			type: "active";
			clientId: string;
			socket: WebSocket;
			mode: LanVoiceBrowserMode;
	  }
	| { type: "closed" };

export interface LanVoiceBrowserClientsOptions {
	ensureConversation(takeoverToken?: string): Promise<void>;
	startDictation(clientId: string): Promise<void>;
	finishDictation(
		clientId: string,
		draft?: string,
		revision?: number,
		selection?: LanVoiceDraftSelection,
	): Promise<void>;
	cancelDictation(clientId: string): Promise<void>;
	onConversationActivity(active: boolean): void | Promise<void>;
	onConversationMute(muted: boolean): void;
	conversationMuted(): boolean;
	onConversationInputTooQuiet(inputTooQuiet: boolean): void;
	onConversationAudio(pcm: Buffer): void;
	onDictationAudio(clientId: string, pcm: Buffer): void;
}

export class LanVoiceBrowserSession {
	private readonly options: LanVoiceBrowserClientsOptions;
	private readonly connections: LanVoiceBrowserConnections;
	private state: LanVoiceBrowserState = { type: "idle" };
	private operation = Promise.resolve();
	private conversationOwnerId: string | undefined;
	private conversationSpeakerSuppressed = false;
	private readonly microphoneLevel: MicrophoneLevelMonitor;

	constructor(
		options: LanVoiceBrowserClientsOptions,
		connections: LanVoiceBrowserConnections,
	) {
		this.options = options;
		this.connections = connections;
		this.microphoneLevel = new MicrophoneLevelMonitor(
			options.onConversationInputTooQuiet,
		);
	}

	get closed(): boolean {
		return this.state.type === "closed";
	}

	get conversationSocket(): WebSocket | undefined {
		return this.state.type === "active" && this.state.mode === "conversation"
			? this.state.socket
			: undefined;
	}

	sendConversationAudio(pcm: Buffer): void {
		const active = this.state;
		if (active.type === "active" && active.mode === "conversation")
			this.connections.sendAudio(active.socket, pcm);
	}

	setConversationSpeakerSuppressed(suppressed: boolean): void {
		if (this.conversationSpeakerSuppressed === suppressed) return;
		this.conversationSpeakerSuppressed = suppressed;
		const active = this.state;
		if (active.type === "active" && active.mode === "conversation") {
			this.connections.sendAudioControl(active.socket, {
				type: "speaker_suppressed",
				suppressed,
			});
		}
	}

	release(
		clientId: string,
		socket?: WebSocket,
		terminateConversation = false,
	): void {
		this.releaseStarting(clientId, socket);
		void this.enqueue(async () => {
			const active = this.state;
			const ownsActive =
				active.type === "active" &&
				active.clientId === clientId &&
				(!socket || active.socket === socket);
			if (ownsActive) this.state = { type: "idle" };
			if (ownsActive && active.mode === "conversation")
				this.microphoneLevel.reset();
			if (terminateConversation && this.conversationOwnerId === clientId) {
				this.conversationOwnerId = undefined;
				await this.options.onConversationActivity(false);
				return;
			}
			if (!ownsActive) return;
			if (active.mode === "dictation")
				await this.options.finishDictation(clientId);
		}).catch((error: unknown) =>
			this.connections.sendControl(clientId, {
				type: "error",
				message: errorMessage(error),
			}),
		);
	}

	releaseStarting(clientId: string, socket?: WebSocket): void {
		const starting = this.state;
		if (
			starting.type !== "starting" ||
			starting.clientId !== clientId ||
			(socket && starting.socket !== socket)
		)
			return;
		this.state = { type: "idle" };
		if (starting.mode === "dictation")
			void this.options.cancelDictation(clientId).catch((error: unknown) =>
				this.connections.sendControl(clientId, {
					type: "error",
					message: errorMessage(error),
				}),
			);
	}

	claim(
		clientId: string,
		socket: WebSocket,
		mode: LanVoiceBrowserMode,
		takeoverToken?: string,
	): Promise<void> {
		const starting = this.state.type === "starting" ? this.state : undefined;
		if (
			starting &&
			(starting.clientId !== clientId ||
				starting.socket !== socket ||
				starting.mode !== mode)
		) {
			this.releaseStarting(starting.clientId, starting.socket);
			this.connections.sendControl(starting.clientId, {
				type: "stop",
				reason: "replaced",
			});
			starting.socket.close(4001, "replaced");
		}
		return this.enqueue(async () => {
			if (
				this.closed ||
				socket.readyState !== WebSocket.OPEN ||
				!this.connections.isCurrentAudio(clientId, socket)
			)
				return;
			const previous = this.state.type === "active" ? this.state : undefined;
			if (
				previous?.clientId === clientId &&
				previous.socket === socket &&
				previous.mode === mode
			)
				return;
			this.state = { type: "idle" };
			if (previous?.mode === "conversation") this.microphoneLevel.reset();
			if (previous && previous.socket !== socket) {
				this.connections.sendControl(previous.clientId, {
					type: "stop",
					reason: "replaced",
				});
				previous.socket.close(4001, "replaced");
			}
			if (previous?.mode === "conversation" && mode !== "conversation") {
				this.conversationOwnerId = undefined;
				await this.options.onConversationActivity(false);
			}
			if (previous?.mode === "dictation")
				await this.options.finishDictation(previous.clientId);
			if (this.closed) return;
			const starting = { type: "starting", clientId, socket, mode } as const;
			this.state = starting;
			if (mode === "conversation") this.conversationOwnerId = clientId;
			try {
				if (mode === "conversation")
					await this.options.ensureConversation(takeoverToken);
				else await this.options.startDictation(clientId);
			} catch (error) {
				if (this.state === starting) this.state = { type: "idle" };
				if (mode === "conversation" && this.conversationOwnerId === clientId)
					this.conversationOwnerId = undefined;
				throw error;
			}
			if (
				this.closed ||
				this.state !== starting ||
				!this.connections.isCurrentAudio(clientId, socket) ||
				socket.readyState !== WebSocket.OPEN
			) {
				if (mode === "dictation") await this.options.cancelDictation(clientId);
				return;
			}
			this.state = { type: "active", clientId, socket, mode };
			if (mode === "conversation")
				await this.options.onConversationActivity(true);
			socket.send(
				JSON.stringify({
					type: "active",
					mode,
					...(mode === "conversation"
						? {
								muted: this.options.conversationMuted(),
								speakerSuppressed: this.conversationSpeakerSuppressed,
							}
						: {}),
				}),
			);
		});
	}

	finish(
		clientId: string,
		socket: WebSocket,
		draft: string,
		revision: number,
		selection: LanVoiceDraftSelection,
	): Promise<void> {
		return this.enqueue(async () => {
			const active = this.state;
			if (
				active.type !== "active" ||
				active.clientId !== clientId ||
				active.socket !== socket ||
				active.mode !== "dictation"
			)
				return;
			this.state = { type: "idle" };
			await this.options.finishDictation(clientId, draft, revision, selection);
			if (!this.closed && socket.readyState === WebSocket.OPEN)
				socket.send(JSON.stringify({ type: "dictation.complete" }));
		});
	}

	cancelDictation(clientId: string): Promise<void> {
		return this.options.cancelDictation(clientId);
	}

	resetConversationInputLevel(): void {
		this.microphoneLevel.reset();
	}

	mute(clientId: string, socket: WebSocket, muted: boolean): void {
		const active = this.state;
		if (
			active.type === "active" &&
			active.clientId === clientId &&
			active.socket === socket &&
			active.mode === "conversation"
		) {
			this.options.onConversationMute(muted);
		}
	}

	receiveAudio(clientId: string, socket: WebSocket, pcm: Buffer): void {
		const active = this.state;
		if (
			active.type !== "active" ||
			active.clientId !== clientId ||
			active.socket !== socket
		)
			return;
		if (active.mode === "conversation") {
			this.microphoneLevel.append(pcm);
			this.options.onConversationAudio(pcm);
		} else this.options.onDictationAudio(clientId, pcm);
	}

	async close(): Promise<void> {
		const active = this.state;
		if (active.type === "closed") {
			await this.operation;
			return;
		}
		this.state = { type: "closed" };
		const failures: unknown[] = [];
		if (active.type === "active" && active.mode === "conversation") {
			try {
				this.conversationOwnerId = undefined;
				await this.options.onConversationActivity(false);
			} catch (error) {
				failures.push(error);
			}
		}
		if (
			(active.type === "starting" || active.type === "active") &&
			active.mode === "dictation"
		) {
			try {
				await this.options.cancelDictation(active.clientId);
			} catch (error) {
				failures.push(error);
			}
		}
		this.connections.close(failures);
		try {
			await this.operation;
		} catch (error) {
			failures.push(error);
		}
		if (failures.length === 1) throw failures[0];
		if (failures.length > 1)
			throw new AggregateError(failures, "LAN browser cleanup failed");
	}

	private enqueue<T>(action: () => Promise<T>): Promise<T> {
		const result = this.operation.then(action, action);
		this.operation = result.then(
			() => undefined,
			() => undefined,
		);
		return result;
	}
}
