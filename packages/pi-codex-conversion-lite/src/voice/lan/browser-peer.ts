import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type {
	CodexRealtimePeer,
	CodexRealtimePeerEvent,
} from "../conversation/peer.ts";

export type LanVoiceBrowserCommand =
	| { type: "send_data"; message: unknown }
	| { type: "stop" };

export class LanVoiceBrowserPeer implements CodexRealtimePeer {
	private readonly offer: string;
	private readonly send: (command: LanVoiceBrowserCommand) => void;
	private readonly eventListeners = new Set<
		(event: CodexRealtimePeerEvent) => void
	>();
	private answer: string | undefined;
	private closed = false;

	constructor(offer: string, send: (command: LanVoiceBrowserCommand) => void) {
		this.offer = offer;
		this.send = send;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onExit(_listener: (error: Error) => void): () => void {
		return () => {};
	}

	async start(_config: CodexConversionConfig): Promise<string> {
		if (this.closed) throw new Error("LAN voice browser disconnected");
		return this.offer;
	}

	applyAnswer(sdp: string): void {
		if (this.closed) throw new Error("LAN voice browser disconnected");
		this.answer = sdp;
	}

	takeAnswer(): string {
		if (!this.answer)
			throw new Error("Codex voice did not return a WebRTC answer");
		return this.answer;
	}

	sendData(message: unknown): void {
		if (this.closed) throw new Error("LAN voice browser disconnected");
		this.send({ type: "send_data", message });
	}

	receiveData(message: unknown): void {
		this.emit({ type: "data", message });
	}

	receiveState(state: string): void {
		this.emit({ type: "state", state });
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			this.send({ type: "stop" });
		} catch {
			// The browser connection may be the reason this peer is closing.
		}
	}

	private emit(event: CodexRealtimePeerEvent): void {
		if (this.closed) return;
		for (const listener of this.eventListeners) listener(event);
	}
}
