import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../auth.ts";

export type CodexRealtimePeerEvent =
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "error"; message: string };

interface CodexRealtimePeerBase {
	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	trace?(event: string, data?: unknown): void;
	sendData(message: unknown): void;
	close(): Promise<void>;
}

export interface CodexRealtimeWebRtcPeer extends CodexRealtimePeerBase {
	readonly kind: "webrtc";
	start(config: CodexConversionConfig): Promise<string>;
	applyAnswer(sdp: string): void;
}

export interface CodexRealtimeSessionPeer extends CodexRealtimePeerBase {
	readonly kind: "session";
	startSession(auth: CodexVoiceAuth, config: CodexConversionConfig, instructions: string): Promise<void>;
}

export type CodexRealtimePeer = CodexRealtimeWebRtcPeer | CodexRealtimeSessionPeer;
