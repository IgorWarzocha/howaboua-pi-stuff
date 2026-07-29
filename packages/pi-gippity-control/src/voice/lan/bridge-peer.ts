import type { GippityControlConfig } from "../../config.ts";
import type {
	CodexRealtimePeerEvent,
	CodexRealtimeWebRtcPeer,
} from "../conversation/peer.ts";
import {
	VoiceHelperClient,
	type VoiceHelperCommand,
	type VoiceHelperEvent,
} from "../helper.ts";

const OFFER_TIMEOUT_MS = 15_000;
const MAX_PCM_BYTES = 24_000 * 2;

interface LanVoiceBridgeHelper {
	readonly protocolVersion: number | undefined;
	start(): Promise<void>;
	send(command: VoiceHelperCommand): void;
	onEvent(listener: (event: VoiceHelperEvent) => void): () => void;
	onExit(listener: (error: Error) => void): () => void;
	close(): Promise<void>;
}

export class LanVoiceBridgePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly helper: LanVoiceBridgeHelper;

	constructor(
		onAudio: (pcm: Buffer) => void,
		helper: LanVoiceBridgeHelper = new VoiceHelperClient(),
	) {
		this.onAudio = onAudio;
		this.helper = helper;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		return this.helper.onEvent((event) => {
			if (event.type === "pcm") {
				this.onAudio(Buffer.from(event.audio, "base64"));
				return;
			}
			if (
				event.type === "state" ||
				event.type === "data" ||
				event.type === "error"
			)
				listener(event);
		});
	}

	onExit(listener: (error: Error) => void): () => void {
		return this.helper.onExit(listener);
	}

	async start(_config: GippityControlConfig): Promise<string> {
		await this.helper.start();
		if (this.helper.protocolVersion !== 4) {
			await this.helper.close();
			throw new Error(
				"Bundled Codex voice helper does not support LAN audio bridging",
			);
		}
		const offer = Promise.withResolvers<string>();
		const removeEvent = this.helper.onEvent((event) => {
			if (event.type === "offer") offer.resolve(event.sdp);
			else if (event.type === "error") offer.reject(new Error(event.message));
		});
		const removeExit = this.helper.onExit((error) => offer.reject(error));
		const timeout = setTimeout(
			() =>
				offer.reject(
					new Error("Codex voice helper did not create a bridge offer"),
				),
			OFFER_TIMEOUT_MS,
		);
		try {
			this.helper.send({ type: "start_v3_bridge" });
			return await offer.promise;
		} catch (error) {
			await this.helper.close();
			throw error;
		} finally {
			clearTimeout(timeout);
			removeEvent();
			removeExit();
		}
	}

	applyAnswer(sdp: string): void {
		this.helper.send({ type: "apply_answer", sdp });
	}

	sendAudio(pcm: Buffer): void {
		if (
			pcm.byteLength === 0 ||
			pcm.byteLength > MAX_PCM_BYTES ||
			pcm.byteLength % 2 !== 0
		)
			throw new Error("Invalid LAN voice PCM frame");
		this.helper.send({
			type: "send_pcm",
			audio: pcm.toString("base64"),
			sample_rate: 24_000,
			num_channels: 1,
		});
	}

	setInputMuted(muted: boolean): void {
		this.helper.send({ type: "set_input_muted", muted });
	}

	sendData(message: unknown): void {
		this.helper.send({ type: "send_data", message });
	}

	close(): Promise<void> {
		return this.helper.close();
	}
}
