import { performance } from "node:perf_hooks";
import type { GrokSessionCallbacks } from "../session.ts";
import { isBase64, textField } from "./wire.ts";

/** Tracks submitted PCM and render drains; turn retirement remains with the session. */
export class GrokSessionPlayback {
	private readonly playbackDrains = new Set<symbol>();
	private playback:
		| { item: string; index: number; started: number; bytes: number }
		| undefined;
	private readonly callbacks: GrokSessionCallbacks;
	private readonly send: (event: unknown) => void;
	private readonly isClosed: () => boolean;
	private readonly onDrained: () => void;
	private readonly onFailure: (error: Error) => void;
	constructor(
		callbacks: GrokSessionCallbacks,
		send: (event: unknown) => void,
		isClosed: () => boolean,
		onDrained: () => void,
		onFailure: (error: Error) => void,
	) {
		this.callbacks = callbacks;
		this.send = send;
		this.isClosed = isClosed;
		this.onDrained = onDrained;
		this.onFailure = onFailure;
	}
	get draining(): number {
		return this.playbackDrains.size;
	}
	clearDrains(): void {
		this.playbackDrains.clear();
	}
	receive(
		event: Record<string, unknown>,
		speechActive: boolean,
		retired: (id: string | undefined) => boolean,
	): void {
		const type = event["type"];
		if (type === "response.output_audio.delta") {
			const responseId = textField(event, "response_id");
			if (speechActive || retired(responseId)) return;
			const delta = textField(event, "delta");
			if (!delta || !isBase64(delta))
				throw new Error("Invalid Grok voice audio");
			const pcm = Buffer.from(delta, "base64");
			if (pcm.length % 2) throw new Error("Incomplete Grok PCM sample");
			const item = textField(event, "item_id");
			if (item) {
				if (this.playback?.item !== item)
					this.playback = {
						item,
						index:
							typeof event["content_index"] === "number"
								? event["content_index"]
								: 0,
						started: performance.now(),
						bytes: 0,
					};
				this.playback!.bytes += pcm.length;
			}
			this.callbacks.audio(pcm);
			this.callbacks.status("speaking");
		}
		if (type === "response.output_audio.done") {
			const responseId = textField(event, "response_id");
			this.callbacks.diagnostic?.({
				type: "playback.submitted",
				response_id: responseId,
				item_id: this.playback?.item,
				currentPlaybackItemBytes: this.playback?.bytes ?? 0,
			});
			if (!speechActive && !retired(responseId)) {
				const drain = Symbol();
				this.playbackDrains.add(drain);
				void this.callbacks.audioDone(responseId).then(
					() => {
						if (!this.playbackDrains.delete(drain) || this.isClosed()) return;
						this.onDrained();
					},
					(error: unknown) =>
						this.onFailure(
							error instanceof Error
								? error
								: new Error("Voice playback failed"),
						),
				);
			}
		}
	}
	truncate(): void {
		const playback = this.playback;
		if (playback)
			this.send({
				type: "conversation.item.truncate",
				item_id: playback.item,
				content_index: playback.index,
				audio_end_ms: Math.max(
					0,
					Math.floor(
						Math.min(playback.bytes / 48, performance.now() - playback.started),
					),
				),
			});
		this.playback = undefined;
	}
}
