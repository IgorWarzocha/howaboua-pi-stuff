import type { GippityControlConfig } from "../config.ts";
import {
	type CodexRealtimePeer,
	type CodexRealtimePeerEvent,
	MAX_REALTIME_SDP_BYTES,
} from "./conversation/peer.ts";
import type { TransferredVoiceControls } from "./handoff-contract.ts";
import {
	type HandoffNotification,
	isRecord,
	type VoiceHandoffLink,
} from "./handoff-wire.ts";

export interface CapturedHandoffAudio {
	readonly inputMuted: boolean;
	/** Current source phase; omitted by older providers means primary. */
	readonly alternateVoice?: boolean;
	sourceActive(): boolean;
	bindControls(controls: TransferredVoiceControls): void;
	release(signal: AbortSignal): Promise<void>;
	createPeer(): Promise<CodexRealtimePeer>;
	start(peer: CodexRealtimePeer): Promise<string>;
	transferred(
		peer: CodexRealtimePeer,
		controls: TransferredVoiceControls,
	): void;
	finished(peer: CodexRealtimePeer | undefined, error: Error): void;
}

/** Source-side media owner. The destination never chooses a physical device. */
export class HandoffAudioHost {
	private sequence = 0;
	private current:
		| {
				generation: number;
				peer: CodexRealtimePeer;
				removeEvent(): void;
				removeExit(): void;
		  }
		| undefined;
	private lastPeer: CodexRealtimePeer | undefined;
	private closed = false;
	private starting = false;
	private released = false;
	private muted: boolean;
	private readonly captured: CapturedHandoffAudio;
	private readonly link: VoiceHandoffLink;
	private readonly controls: TransferredVoiceControls;
	private readonly onMute: (muted: boolean) => void;

	constructor(
		captured: CapturedHandoffAudio,
		link: VoiceHandoffLink,
		controls: TransferredVoiceControls,
		onMute: (muted: boolean) => void,
	) {
		this.captured = captured;
		this.link = link;
		this.controls = controls;
		this.onMute = onMute;
		this.muted = captured.inputMuted;
	}

	setInputMuted(muted: boolean): void {
		this.current?.peer.setInputMuted(muted);
		this.muted = muted;
		this.onMute(muted);
	}

	get inputMuted(): boolean {
		return this.muted;
	}

	async release(signal: AbortSignal): Promise<void> {
		await this.captured.release(signal);
		if (this.closed || signal.aborted)
			throw new Error("Voice transfer cancelled");
		this.released = true;
	}

	async start(): Promise<{ generation: number; sdp: string }> {
		if (this.closed || !this.released || this.current || this.starting)
			throw new Error("The source audio endpoint is not ready for a new call");
		this.starting = true;
		try {
			const peer = await this.captured.createPeer();
			this.lastPeer = peer;
			if (this.closed) {
				await peer.close();
				throw new Error("Voice transfer cancelled");
			}
			const generation = ++this.sequence;
			const removeEvent = peer.onEvent((event) => {
				if (!this.closed && this.current?.generation === generation)
					this.link.notify({ type: "peer.event", generation, event });
			});
			const removeExit = peer.onExit((error) => this.link.fail(error));
			this.current = { generation, peer, removeEvent, removeExit };
			this.captured.transferred(peer, this.controls);
			const sdp = await this.captured.start(peer);
			if (this.closed || this.current?.generation !== generation)
				throw new Error("Voice transfer cancelled");
			return { generation, sdp };
		} finally {
			this.starting = false;
		}
	}

	async closePeer(value: unknown): Promise<void> {
		if (!isRecord(value) || !Number.isSafeInteger(value["generation"]))
			throw new Error("Invalid voice peer close");
		if (value["generation"] !== this.current?.generation) return;
		await this.closeCurrent();
	}

	command(
		message: Extract<HandoffNotification, { type: "peer.command" }>,
	): void {
		const current = this.current;
		if (!current || message.generation !== current.generation) return;
		const { peer } = current;
		if (message.command === "answer" && validSdp(message.value))
			peer.applyAnswer(message.value);
		else if (message.command === "data" && isRecord(message.value))
			peer.sendData(message.value);
		else if (message.command === "mute" && typeof message.value === "boolean") {
			this.setInputMuted(message.value);
		} else if (
			message.command === "suppress" &&
			typeof message.value === "boolean"
		)
			peer.setSpeakerSuppressed(message.value);
		else throw new Error("Invalid voice peer control");
	}

	async close(error: Error): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		try {
			await this.closeCurrent();
		} finally {
			this.captured.finished(this.lastPeer, error);
		}
	}

	private async closeCurrent(): Promise<void> {
		const current = this.current;
		this.current = undefined;
		if (!current) return;
		current.removeEvent();
		current.removeExit();
		await current.peer.close();
	}
}

/** Destination-side peer: call setup/auth and all Pi work remain local here. */
export class HandoffRemotePeer implements CodexRealtimePeer {
	readonly kind = "webrtc" as const;
	private readonly listeners = new Set<
		(event: CodexRealtimePeerEvent) => void
	>();
	private readonly exitListeners = new Set<(error: Error) => void>();
	private generation: number | undefined;
	private starting: Promise<string> | undefined;
	private closed = false;

	private readonly link: VoiceHandoffLink;
	constructor(link: VoiceHandoffLink) {
		this.link = link;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}
	start(_config: GippityControlConfig): Promise<string> {
		if (this.starting || this.closed)
			return Promise.reject(new Error("Voice peer already started or closed"));
		this.starting = this.open();
		return this.starting;
	}
	private async open(): Promise<string> {
		const result = await this.link.request("peer.start");
		if (
			!isRecord(result) ||
			typeof result["generation"] !== "number" ||
			!Number.isSafeInteger(result["generation"]) ||
			result["generation"] <= 0 ||
			!validSdp(result["sdp"])
		)
			throw new Error("Source audio did not return a valid voice offer");
		this.generation = result["generation"];
		return result["sdp"];
	}
	applyAnswer(sdp: string): void {
		this.command("answer", sdp);
	}
	sendData(message: unknown): void {
		this.command("data", message);
	}
	setInputMuted(muted: boolean): void {
		this.command("mute", muted);
	}
	setSpeakerSuppressed(suppressed: boolean): void {
		this.command("suppress", suppressed);
	}
	private command(command: string, value: unknown): void {
		if (this.closed) return;
		if (this.generation === undefined)
			throw new Error("Voice peer is not connected");
		this.link.notify({
			type: "peer.command",
			generation: this.generation,
			command,
			value,
		});
	}

	receive(generation: number, value: unknown): void {
		if (this.closed || this.generation !== generation) return;
		const event = readPeerEvent(value);
		for (const listener of this.listeners) listener(event);
	}

	disconnected(error: Error): void {
		if (this.closed) return;
		for (const listener of this.exitListeners) listener(error);
	}

	async close(): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.listeners.clear();
		this.exitListeners.clear();
		try {
			await this.starting;
		} catch {
			return;
		} // Startup already reports its failure; there is no established peer to close.
		if (this.generation !== undefined && !this.link.closed) {
			try {
				await this.link.request("peer.close", { generation: this.generation });
			} catch (error) {
				// Closing transport also tears down the source audio owner.
				if (!this.link.closed) throw error;
			}
		}
	}
}

function validSdp(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		Buffer.byteLength(value) <= MAX_REALTIME_SDP_BYTES
	);
}

function readPeerEvent(value: unknown): CodexRealtimePeerEvent {
	if (isRecord(value)) {
		if (value["type"] === "playback_activity")
			return { type: "playback_activity" };
		if (
			value["type"] === "state" &&
			typeof value["state"] === "string" &&
			value["state"].length <= 128
		)
			return { type: "state", state: value["state"] };
		if (value["type"] === "data" && isRecord(value["message"]))
			return { type: "data", message: value["message"] };
		if (
			value["type"] === "error" &&
			typeof value["message"] === "string" &&
			value["message"].length <= 4_000
		)
			return { type: "error", message: value["message"] };
	}
	throw new Error("Invalid voice peer event");
}
