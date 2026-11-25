import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { VoiceAudioDiagnostics } from "../helper-protocol.ts";

export const MAX_REALTIME_SDP_BYTES = 256 * 1024;

export type RealtimePeerEvent =
	| { type: "state"; state: string }
	| { type: "data"; message: unknown }
	| { type: "playback_activity" }
	| { type: "audio_diagnostics"; diagnostics: VoiceAudioDiagnostics }
	| { type: "error"; message: string };

interface RealtimePeerBase {
	onEvent(listener: (event: RealtimePeerEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	sendData(message: unknown): void;
	setInputMuted(muted: boolean): void;
	setSpeakerSuppressed(suppressed: boolean): void;
	finishPlayback?(signal: AbortSignal): Promise<void>;
	readonly playbackSealed?: boolean;
	close(): Promise<void>;
}

export interface RealtimeWebRtcPeer extends RealtimePeerBase {
	readonly kind: "webrtc";
	start(config: CodexConversionConfig): Promise<string>;
	applyAnswer(sdp: string): void;
}

export type RealtimePeer = RealtimeWebRtcPeer;
