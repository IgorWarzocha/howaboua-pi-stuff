import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type {
	CodexRealtimePeer,
	CodexRealtimePeerEvent,
} from "../conversation/peer.ts";
import type { LanVoiceDiagnostics } from "./diagnostics.ts";

export type LanVoiceBrowserCommand =
	| { type: "send_data"; message: unknown }
	| { type: "stop" };

export class LanVoiceBrowserPeer implements CodexRealtimePeer {
	private readonly offer: string;
	private readonly send: (command: LanVoiceBrowserCommand) => void;
	private readonly diagnostics: LanVoiceDiagnostics;
	private readonly eventListeners = new Set<
		(event: CodexRealtimePeerEvent) => void
	>();
	private answer: string | undefined;
	private closed = false;

	constructor(
		offer: string,
		send: (command: LanVoiceBrowserCommand) => void,
		diagnostics: LanVoiceDiagnostics,
	) {
		this.offer = offer;
		this.send = send;
		this.diagnostics = diagnostics;
	}

	trace(event: string, data?: unknown): void {
		this.diagnostics.write("realtime", event, data);
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
		this.trace("peer.offer", { sdp: this.offer });
		return this.offer;
	}

	applyAnswer(sdp: string): void {
		if (this.closed) throw new Error("LAN voice browser disconnected");
		this.answer = sdp;
		this.trace("peer.answer", { sdp });
	}

	takeAnswer(): string {
		if (!this.answer)
			throw new Error("Codex voice did not return a WebRTC answer");
		return this.answer;
	}

	sendData(message: unknown): void {
		if (this.closed) throw new Error("LAN voice browser disconnected");
		this.trace("data.outbound", message);
		this.send({ type: "send_data", message });
	}

	receiveData(message: unknown): void {
		this.trace("data.inbound", message);
		this.emit({ type: "data", message });
	}

	receiveState(state: string): void {
		this.trace("peer.state", { state });
		this.emit({ type: "state", state });
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.trace("peer.close");
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
