import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import { startRealtimeOffer } from "../conversation/helper-offer.ts";
import type { CodexRealtimePeerEvent, CodexRealtimeWebRtcPeer } from "../conversation/peer.ts";

export class LanHostRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly helper = new VoiceHelperClient();
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly onSpeakerSuppressed: (suppressed: boolean) => void;
	private playbackEpoch = 0;
	private speakerSuppressed = false;

	constructor(options: {
		onAudio(pcm: Buffer): void;
		onSpeakerSuppressed(suppressed: boolean): void;
	}) {
		this.onAudio = options.onAudio;
		this.onSpeakerSuppressed = options.onSpeakerSuppressed;
	}

	get isSpeakerSuppressed(): boolean { return this.speakerSuppressed; }

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		return this.helper.onEvent((event) => {
			if (event.type === "pcm") {
				if (this.speakerSuppressed || event.epoch !== this.playbackEpoch) return;
				this.onAudio(Buffer.from(event.audio, "base64"));
				return;
			}
			const peerEvent = toPeerEvent(event);
			if (peerEvent) listener(peerEvent);
		});
	}

	onExit(listener: (error: Error) => void): () => void {
		return this.helper.onExit(listener);
	}

	start(config: CodexConversionConfig): Promise<string> {
		return startRealtimeOffer(this.helper, config, "bridge");
	}

	applyAnswer(sdp: string): void {
		this.helper.send({ type: "apply_answer", sdp });
	}

	sendData(message: unknown): void {
		this.helper.send({ type: "send_data", message });
	}

	sendAudio(pcm: Buffer): void {
		this.helper.send({ type: "send_pcm", audio: pcm.toString("base64"), sample_rate: 24_000, num_channels: 1 });
	}

	setInputMuted(muted: boolean): void {
		this.helper.send({ type: "set_input_muted", muted });
	}

	setSpeakerSuppressed(suppressed: boolean): void {
		if (this.speakerSuppressed === suppressed) return;
		const epoch = this.playbackEpoch + 1;
		this.helper.send({ type: "set_speaker_suppressed", suppressed, epoch });
		this.playbackEpoch = epoch;
		this.speakerSuppressed = suppressed;
		this.onSpeakerSuppressed(suppressed);
	}

	close(): Promise<void> {
		return this.helper.close();
	}
}

function toPeerEvent(event: VoiceHelperEvent): CodexRealtimePeerEvent | undefined {
	if (event.type === "state" || event.type === "data" || event.type === "error" || event.type === "playback_activity") return event;
	return undefined;
}
