import type { GippityControlConfig } from "../../config.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import type {
	CodexRealtimePeerEvent,
	CodexRealtimeWebRtcPeer,
} from "./peer.ts";

const OFFER_TIMEOUT_MS = 15_000;

export class NativeCodexRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly helper = new VoiceHelperClient();

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		return this.helper.onEvent((event) => {
			const peerEvent = toPeerEvent(event);
			if (peerEvent) listener(peerEvent);
		});
	}

	onExit(listener: (error: Error) => void): () => void {
		return this.helper.onExit(listener);
	}

	async start(config: GippityControlConfig): Promise<string> {
		await this.helper.start();
		const offer = Promise.withResolvers<string>();
		const removeEvent = this.helper.onEvent((event) => {
			if (event.type === "offer") offer.resolve(event.sdp);
			else if (event.type === "error") offer.reject(new Error(event.message));
		});
		const removeExit = this.helper.onExit((error) => offer.reject(error));
		const timeout = setTimeout(
			() =>
				offer.reject(new Error("Codex voice helper did not create an offer")),
			OFFER_TIMEOUT_MS,
		);
		this.helper.send({
			type: "start_v3",
			...(config.voice.inputDevice
				? { microphone: config.voice.inputDevice }
				: {}),
			...(config.voice.outputDevice
				? { speaker: config.voice.outputDevice }
				: {}),
		});
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

	close(): Promise<void> {
		return this.helper.close();
	}
}

function toPeerEvent(
	event: VoiceHelperEvent,
): CodexRealtimePeerEvent | undefined {
	if (event.type === "state" || event.type === "data" || event.type === "error")
		return event;
	return undefined;
}
