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
	private preserveLink = false;
	private paused = false;
	private closing: Promise<void> | undefined;
	private generation = 0;
	private readonly link: VoiceHandoffLink;
	constructor(link: VoiceHandoffLink) {
		this.link = link;
	}
	async start(callbacks: AudioCallbacks): Promise<void> {
		if (this.closed) throw new Error("Voice audio connection closed");
		const generation = this.generation;
		await this.closing;
		if (this.closed || generation !== this.generation)
			throw new Error("Voice audio startup cancelled");
		this.closing = undefined;
		this.callbacks = callbacks;
		if (this.paused) {
			await this.link.request("audio.start");
			if (this.closed || generation !== this.generation)
				throw new Error("Voice audio startup cancelled");
			this.paused = false;
		}
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
	close(): Promise<void> {
		this.generation++;
		return (this.closing ??= this.closeCurrent());
	}
	private async closeCurrent(): Promise<void> {
		if (this.closed) return;
		this.callbacks = undefined;
		if (this.preserveLink) {
			this.paused = true;
			await this.link.request("audio.close");
		} else {
			this.closed = true;
			this.link.close();
		}
	}

	/** Explicit call Stop retains the selected session's control channel. */
	stopCall(): void {
		this.preserveLink = true;
	}
	resumeCall(): void {
		this.preserveLink = false;
	}
	disconnect(): void {
		this.generation++;
		this.closed = true;
		this.callbacks = undefined;
		this.link.close();
	}
}
