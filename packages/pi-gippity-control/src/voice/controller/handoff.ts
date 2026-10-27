import type { ActiveVoiceGuard } from "../active-owner.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import type { TransferredVoiceControls } from "../handoff-contract.ts";
import type { CapturedHandoffAudio } from "../handoff-peer.ts";
import type { VoiceControllerRuntime } from "./start.ts";
import { VOICE_STATUS_KEY, type VoiceSession } from "./support.ts";

interface HandoffCallbacks {
	active(): boolean;
	status(): string;
	inputMuted(): boolean;
	currentSession(): VoiceSession | undefined;
	setInputMuted(muted: boolean): boolean;
	notifyMute(muted: boolean): void;
	renderStatus(status: string): void;
	renderCurrentStatus(): void;
	stop(options: { announce: boolean; transferring: boolean }): Promise<void>;
}

/** Owns arrival reservations and transferred audio subscriptions, not the live call. */
export class ControllerHandoff {
	private handoffReservation: AbortController | undefined;
	private forwardedAudio: TransferredVoiceControls | undefined;
	private departingSession: CodexRealtimeConversation | undefined;
	private removeForwardedEvents: (() => void) | undefined;
	private readonly runtime: VoiceControllerRuntime;
	private readonly ownership: ActiveVoiceGuard;
	private readonly callbacks: HandoffCallbacks;
	constructor(
		runtime: VoiceControllerRuntime,
		ownership: ActiveVoiceGuard,
		callbacks: HandoffCallbacks,
	) {
		this.runtime = runtime;
		this.ownership = ownership;
		this.callbacks = callbacks;
	}
	get reservation(): AbortController | undefined {
		return this.handoffReservation;
	}
	get forwarded(): TransferredVoiceControls | undefined {
		return this.forwardedAudio;
	}
	get departing(): CodexRealtimeConversation | undefined {
		return this.departingSession;
	}
	cancelReservation(): void {
		this.handoffReservation?.abort();
		this.handoffReservation = undefined;
	}
	detachForwarded(): void {
		this.removeForwardedEvents?.();
		this.removeForwardedEvents = undefined;
		this.forwardedAudio = undefined;
	}
	reserveHandoffArrival(): { signal: AbortSignal; release(): void } {
		this.ownership.assertAvailable();
		if (
			(this.callbacks.active() && this.callbacks.status() !== "transferred") ||
			this.handoffReservation
		)
			throw new Error(
				"The target already has an active or preparing voice call",
			);
		const reservation = new AbortController();
		this.handoffReservation = reservation;
		return {
			signal: reservation.signal,
			release: () => {
				if (this.handoffReservation === reservation)
					this.handoffReservation = undefined;
			},
		};
	}

	captureHandoffAudio(): CapturedHandoffAudio {
		const state = this.runtime.state;
		const config = this.runtime.config;
		if (state.type !== "conversation" || !config)
			throw new Error(
				"Start realtime voice before transferring its microphone",
			);
		const { session } = state;
		const plan = this.runtime.realtimePeerPlan;
		const inputMuted = this.callbacks.inputMuted();
		let released = false;
		let transferredControls: TransferredVoiceControls | undefined;
		const bindControls = (controls: TransferredVoiceControls) => {
			transferredControls = controls;
			if (this.forwardedAudio !== controls) {
				this.removeForwardedEvents?.();
				this.forwardedAudio = controls;
				this.removeForwardedEvents = controls.onSessionEvent((event, value) => {
					if (
						this.runtime.state.type !== "idle" &&
						this.runtime.state.type !== "failed"
					)
						return;
					if (event === "voice_mute" && typeof value === "boolean") {
						this.callbacks.notifyMute(value);
						this.callbacks.renderCurrentStatus();
					}
				});
			}
			if (
				this.runtime.state.type === "idle" ||
				this.runtime.state.type === "failed"
			)
				this.callbacks.renderStatus("connected to another session");
		};
		return {
			inputMuted,
			alternateVoice: this.runtime.alternateVoice ?? false,
			sourceActive: () =>
				this.callbacks.currentSession() === session &&
				this.runtime.state.type === "conversation",
			release: async (signal) => {
				if (this.callbacks.currentSession() !== session)
					throw new Error("Source voice changed before transfer");
				transferredControls?.setInputMuted(this.callbacks.inputMuted());
				this.departingSession = session;
				session.setInputMuted(true);
				await session.waitForPlaybackEnd(signal);
				signal.throwIfAborted();
				if (this.callbacks.currentSession() !== session)
					throw new Error("Source voice changed before transfer");
				released = true;
				await this.callbacks.stop({ announce: true, transferring: true });
			},
			createPeer: async () => {
				if (!released)
					throw new Error("Source voice has not released its audio");
				return (
					plan?.createPeer() ??
					new (
						await import("../conversation/native-peer.ts")
					).NativeCodexRealtimePeer()
				);
			},
			start: (peer) => peer.start(config),
			bindControls,
			transferred: (peer, controls) => {
				bindControls(controls);
				plan?.onTransferred?.(peer, controls);
			},
			finished: (peer, error) => {
				if (this.departingSession === session) {
					this.departingSession = undefined;
					if (!released && this.callbacks.currentSession() === session)
						this.callbacks.setInputMuted(
							transferredControls?.inputMuted ?? inputMuted,
						);
				}
				if (
					this.forwardedAudio === transferredControls &&
					transferredControls
				) {
					this.removeForwardedEvents?.();
					this.removeForwardedEvents = undefined;
					this.forwardedAudio = undefined;
					if (
						this.runtime.state.type === "idle" ||
						this.runtime.state.type === "failed"
					)
						this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
				}
				if (!released) return;
				if (peer) plan?.onTransferEnded?.(peer, error);
				else plan?.onInactive?.(session, error, false);
				plan?.onStopped?.();
			},
		};
	}
}
