import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import { VoiceHelperClient, type VoiceHelperEvent } from "../helper.ts";
import { startRealtimeOffer } from "./helper-offer.ts";
import type { CodexRealtimePeerEvent, CodexRealtimeWebRtcPeer } from "./peer.ts";

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

	start(config: CodexConversionConfig): Promise<string> {
		return startRealtimeOffer(this.helper, config, "native");
	}

	applyAnswer(sdp: string): void {
		this.helper.send({ type: "apply_answer", sdp });
	}

	sendData(message: unknown): void {
		this.helper.send({ type: "send_data", message });
	}

	setInputMuted(muted: boolean): void {
		this.helper.send({ type: "set_input_muted", muted });
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
