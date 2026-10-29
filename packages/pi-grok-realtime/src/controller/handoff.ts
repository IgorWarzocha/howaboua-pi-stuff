import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AudioCallbacks } from "../audio.ts";
import type { GrokCall } from "../call/lifecycle.ts";
import type { TransferredVoiceControls } from "../handoff-contract.ts";
import { isRecord } from "../handoff-wire.ts";

interface HandoffCallbacks {
	currentCall(): GrokCall | undefined;
	releaseCall(call: GrokCall): void;
	assertAvailable(): void;
	setStatus(status: string): void;
	enqueue(action: () => Promise<void>): Promise<void>;
	lifecycle(ctx: ExtensionContext, state: "started" | "ended"): void;
	transferredEvent(event: string, data: unknown): void;
	changed(): void;
}
/** Owns reservations and the transferred control subscription across local call replacement. */
export class GrokControllerHandoff {
	private reservation: AbortController | undefined;
	private transferred: TransferredVoiceControls | undefined;
	private transferredBusy = false;
	private readonly callbacks: HandoffCallbacks;
	constructor(callbacks: HandoffCallbacks) {
		this.callbacks = callbacks;
	}
	get preparing(): boolean {
		return Boolean(this.reservation);
	}
	get controls(): TransferredVoiceControls | undefined {
		return this.transferred;
	}
	get busy(): boolean {
		return this.transferredBusy;
	}
	cancelReservation(): void {
		this.reservation?.abort();
	}
	takeTransferred(): TransferredVoiceControls | undefined {
		const transferred = this.transferred;
		this.transferred = undefined;
		return transferred;
	}
	reserveHandoffArrival(): { signal: AbortSignal; release(): void } {
		if (this.callbacks.currentCall() || this.reservation)
			throw new Error("Grok voice is already active or preparing");
		this.callbacks.assertAvailable();
		const reservation = new AbortController();
		this.reservation = reservation;
		return {
			signal: reservation.signal,
			release: () => {
				if (this.reservation === reservation) this.reservation = undefined;
			},
		};
	}
	captureHandoffAudio() {
		const call = this.callbacks.currentCall();
		if (!call?.announced || call.reconnecting || call.abort.signal.aborted)
			throw new Error("Grok voice is not ready to transfer");
		let transferredControls: TransferredVoiceControls | undefined;
		return {
			audio: call.audio,
			inputMuted: call.muted,
			alternateVoice: call.alternateVoice,
			sourceActive: () => this.callbacks.currentCall() === call,
			closed: () => {
				if (this.transferred !== transferredControls) return;
				// Retain the failed selection: Start must report disconnection, not
				// silently replace the destination with a call on the audio host.
				this.callbacks.changed();
			},
			release: async (
				callbacks: AudioCallbacks,
				controls: TransferredVoiceControls,
			) =>
				this.callbacks.enqueue(async () => {
					if (
						this.callbacks.currentCall() !== call ||
						call.abort.signal.aborted
					)
						throw new Error("Source voice changed during transfer");
					if (!call.ctx.isIdle())
						throw new Error(
							"Source agent started working again before voice transfer",
						);
					// Preparation can outlast a microphone toggle on the original call.
					controls.setInputMuted(call.muted);
					call.removeAudioAbort();
					call.inputCallbacks = callbacks;
					this.callbacks.releaseCall(call);
					this.transferred = controls;
					transferredControls = controls;
					this.transferredBusy = false;
					this.callbacks.transferredEvent("handoff_started", {});
					controls.onSessionEvent((event, data) => {
						if (this.transferred !== controls) return;
						if (event === "agent_start") this.transferredBusy = true;
						else if (event === "agent_settled") this.transferredBusy = false;
						else if (
							event === "voice_status" &&
							isRecord(data) &&
							typeof data["piBusy"] === "boolean"
						)
							this.transferredBusy = data["piBusy"];
						this.callbacks.transferredEvent(event, data);
						this.callbacks.changed();
					});
					call.abort.abort();
					call.session.close();
					call.audio.clear();
					this.callbacks.lifecycle(call.ctx, "ended");
					this.callbacks.setStatus("transferred");
				}),
		};
	}
}
