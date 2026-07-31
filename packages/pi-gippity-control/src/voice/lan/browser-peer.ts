import type { GippityControlConfig } from "../../config.ts";
import type {
	CodexRealtimePeerEvent,
	CodexRealtimeWebRtcPeer,
} from "../conversation/peer.ts";

type SendBrowserControl = (value: unknown) => void;

export type LanBrowserPeerEvent =
	| { type: "peer_state"; state: string }
	| { type: "peer_data"; message: unknown }
	| { type: "peer_error"; message: string };

export class LanBrowserRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly offerSdp: string;
	private readonly sendControl: SendBrowserControl;
	private readonly eventListeners = new Set<
		(event: CodexRealtimePeerEvent) => void
	>();
	private active = false;
	private closed = false;

	constructor(offerSdp: string, sendControl: SendBrowserControl) {
		this.offerSdp = offerSdp;
		this.sendControl = sendControl;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onExit(_listener: (error: Error) => void): () => void {
		return () => {};
	}

	async start(_config: GippityControlConfig): Promise<string> {
		if (this.closed) throw new Error("LAN realtime peer is closed");
		return this.offerSdp;
	}

	applyAnswer(sdp: string): void {
		this.send({ type: "answer", sdp });
	}

	sendData(message: unknown): void {
		this.send({ type: "peer_data", message });
	}

	setInputMuted(muted: boolean): void {
		this.send({ type: "mute", muted });
	}

	markActive(): void {
		if (!this.closed) this.active = true;
	}

	receive(event: LanBrowserPeerEvent): void {
		if (this.closed) return;
		const peerEvent: CodexRealtimePeerEvent =
			event.type === "peer_state"
				? { type: "state", state: event.state }
				: event.type === "peer_data"
					? { type: "data", message: event.message }
					: { type: "error", message: event.message };
		for (const listener of this.eventListeners) listener(peerEvent);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		if (this.active) {
			try {
				this.sendControl({ type: "stop", reason: "upstream-error" });
			} catch {}
		}
		this.eventListeners.clear();
	}

	private send(value: unknown): void {
		if (this.closed) throw new Error("LAN realtime peer is closed");
		this.sendControl(value);
	}
}
