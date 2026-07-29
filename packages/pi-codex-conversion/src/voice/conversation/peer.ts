import type { CodexConversionConfig } from "../../adapter/activation/config.ts";

export const MAX_REALTIME_SDP_BYTES = 256 * 1024;

export type CodexRealtimePeerEvent =
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "error"; message: string };

interface CodexRealtimePeerBase {
	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	sendData(message: unknown): void;
	setInputMuted(muted: boolean): void;
	close(): Promise<void>;
}

export interface CodexRealtimeWebRtcPeer extends CodexRealtimePeerBase {
	readonly kind: "webrtc";
	start(config: CodexConversionConfig): Promise<string>;
	applyAnswer(sdp: string): void;
}

export type CodexRealtimePeer = CodexRealtimeWebRtcPeer;
