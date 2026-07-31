import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import type { CodexRealtimePeerEvent, CodexRealtimeWebRtcPeer } from "../conversation/peer.ts";

const OFFER_TIMEOUT_MS = 15_000;

export class LanHostRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly helper = new VoiceHelperClient();
	private readonly onAudio: (pcm: Buffer) => void;
	private readonly onFailure: (error: Error) => void;
	private failed = false;
	private closing = false;

	constructor(options: { onAudio(pcm: Buffer): void; onFailure(error: Error): void }) {
		this.onAudio = options.onAudio;
		this.onFailure = options.onFailure;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		return this.helper.onEvent((event) => {
			if (event.type === "pcm") {
				this.onAudio(Buffer.from(event.audio, "base64"));
				return;
			}
			const peerEvent = toPeerEvent(event);
			if (peerEvent) listener(peerEvent);
			if (event.type === "error") this.fail(new Error(event.message));
		});
	}

	onExit(listener: (error: Error) => void): () => void {
		const remove = this.helper.onExit(listener);
		const removeFailure = this.helper.onExit((error) => { if (!this.closing) this.fail(error); });
		return () => { remove(); removeFailure(); };
	}

	async start(config: CodexConversionConfig): Promise<string> {
		await this.helper.start(config.tools.customRustBinariesDir);
		if (this.helper.protocolVersion !== 5) {
			const actualVersion = this.helper.protocolVersion ?? "unknown";
			await this.helper.close();
			throw new Error(`Incompatible Codex voice helper protocol ${actualVersion}; expected 5`);
		}
		const offer = Promise.withResolvers<string>();
		const removeEvent = this.helper.onEvent((event) => {
			if (event.type === "offer") offer.resolve(event.sdp);
			else if (event.type === "error") offer.reject(new Error(event.message));
		});
		const removeExit = this.helper.onExit((error) => offer.reject(error));
		const timeout = setTimeout(() => offer.reject(new Error("Codex voice helper did not create an offer")), OFFER_TIMEOUT_MS);
		this.helper.send({ type: "start_v3_bridge" });
		return offer.promise.finally(() => {
			clearTimeout(timeout);
			removeEvent();
			removeExit();
		});
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

	close(): Promise<void> {
		this.closing = true;
		return this.helper.close();
	}

	private fail(error: Error): void {
		if (this.failed) return;
		this.failed = true;
		this.onFailure(error);
	}
}

function toPeerEvent(event: VoiceHelperEvent): CodexRealtimePeerEvent | undefined {
	if (event.type === "state" || event.type === "data" || event.type === "error") return event;
	return undefined;
}
