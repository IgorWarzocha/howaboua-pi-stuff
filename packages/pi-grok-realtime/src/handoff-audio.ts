import type { AudioCallbacks, RealtimeAudio } from "./audio.ts";
import {
	decodePcm,
	type HandoffNotification,
	VoiceHandoffLink,
} from "./handoff-wire.ts";

/** Remote Pi owns the provider socket; the original device owns capture/playout. */
export class HandoffAudio implements RealtimeAudio {
	private callbacks: AudioCallbacks | undefined;
	private closed = false;
	private readonly link: VoiceHandoffLink;
	constructor(link: VoiceHandoffLink) {
		this.link = link;
	}
	async start(callbacks: AudioCallbacks): Promise<void> {
		if (this.closed) throw new Error("Voice audio connection closed");
		this.callbacks = callbacks;
	}
	receive(message: HandoffNotification): void {
		if (message.type !== "audio.input")
			throw new Error("Invalid destination audio frame");
		this.callbacks?.onAudio(decodePcm(message.pcm));
	}
	play(pcm: Buffer): void {
		this.link.notify({ type: "audio.play", pcm: pcm.toString("base64") });
	}
	clear(): void {
		if (!this.link.closed) this.link.notify({ type: "audio.clear" });
	}
	async drain(): Promise<void> {
		await this.link.request("audio.drain");
	}
	setMuted(muted: boolean): void {
		this.link.notify({ type: "session.mute", muted });
	}
	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.callbacks = undefined;
		this.link.close();
	}
}
