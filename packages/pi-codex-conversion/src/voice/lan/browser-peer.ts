import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import { startRealtimeOffer } from "../conversation/helper-offer.ts";
import type { CodexRealtimePeerEvent, CodexRealtimeWebRtcPeer } from "../conversation/peer.ts";

export class LanHostRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly helper = new VoiceHelperClient();
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly onSpeakerSuppressed: (suppressed: boolean) => void;
	private readonly drainPlayback: (signal: AbortSignal, seal: () => Promise<void>) => Promise<void>;
	private finishing = false;
	private playbackEpoch = 0;
	private speakerSuppressed = false;
	private inputState: "pending" | "ready" | "finishing" | "closed" = "pending";

	constructor(options: {
		onAudio(pcm: Buffer): void;
		onSpeakerSuppressed(suppressed: boolean): void;
		drainPlayback(signal: AbortSignal, seal: () => Promise<void>): Promise<void>;
	}) {
		this.onAudio = options.onAudio;
		this.onSpeakerSuppressed = options.onSpeakerSuppressed;
		this.drainPlayback = options.drainPlayback;
		// PCM forwarding has one owner, independent of event subscriptions.
		this.helper.onEvent((event) => {
			if (event.type !== "pcm" || this.inputState === "closed" || this.speakerSuppressed || event.epoch !== this.playbackEpoch) return;
			this.onAudio(Buffer.from(event.audio, "base64"));
		});
	}

	get isSpeakerSuppressed(): boolean { return this.speakerSuppressed; }

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		return this.helper.onEvent((event) => {
			if (this.finishing && event.type === "state" && event.state === "closed") return;
			const peerEvent = toPeerEvent(event);
			if (peerEvent) listener(peerEvent);
		});
	}

	onExit(listener: (error: Error) => void): () => void {
		return this.helper.onExit(listener);
	}

	get playbackSealed(): boolean {
		return this.finishing;
	}

	async start(config: CodexConversionConfig): Promise<string> {
		const sdp = await startRealtimeOffer(this.helper, config, "bridge");
		if (this.inputState === "pending") this.inputState = "ready";
		return sdp;
	}

	applyAnswer(sdp: string): void {
		this.helper.send({ type: "apply_answer", sdp });
	}

	sendData(message: unknown): void {
		if (this.finishing) return;
		this.helper.send({ type: "send_data", message });
	}

	sendAudio(pcm: Buffer): void {
		if (this.inputState !== "ready") return;
		this.helper.send({ type: "send_pcm", audio: pcm.toString("base64"), sample_rate: 24_000, num_channels: 1 });
	}

	setInputMuted(muted: boolean): void {
		if (this.finishing) return;
		this.helper.send({ type: "set_input_muted", muted });
	}

	setSpeakerSuppressed(suppressed: boolean): void {
		if (this.finishing || this.speakerSuppressed === suppressed) return;
		const epoch = this.playbackEpoch + 1;
		this.helper.send({ type: "set_speaker_suppressed", suppressed, epoch });
		this.playbackEpoch = epoch;
		this.speakerSuppressed = suppressed;
		this.onSpeakerSuppressed(suppressed);
	}

	close(): Promise<void> {
		this.inputState = "closed";
		return this.helper.close();
	}

	async finishPlayback(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		// Final-only: seal this source before placing the marker on the PCM socket.
		// stopped follows all PCM emitted by its workers; no old source can race
		// the device acknowledgement or a successor call.
		await this.drainPlayback(signal, async () => {
			this.finishing = true;
			this.inputState = "finishing";
			await this.helper.stop();
			signal.throwIfAborted();
		});
	}
}

function toPeerEvent(event: VoiceHelperEvent): CodexRealtimePeerEvent | undefined {
	if (event.type === "state" || event.type === "data" || event.type === "error" || event.type === "playback_activity" || event.type === "audio_diagnostics") return event;
	return undefined;
}
