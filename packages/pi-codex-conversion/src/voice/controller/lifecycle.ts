import type { ActiveVoiceGuard } from "../active-owner.ts";
import { markRealtimePeerInactive } from "./reconnect.ts";
import type { VoiceControllerRuntime } from "./start.ts";
import {
	currentVoiceSession,
	VOICE_STATUS_KEY,
	voiceModeForState,
} from "./support.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import type { CodexVoiceSessionMessages } from "../session-messages.ts";
import { formatVoiceAudioError } from "../setup.ts";
import type { ControllerHandoff } from "./handoff.ts";

/** Serial resource ownership stays in ActiveVoiceGuard; this owner closes each mode and publishes its terminal state. */
export class ControllerLifecycle {
	private readonly runtime: VoiceControllerRuntime;
	private readonly ownership: ActiveVoiceGuard;
	private readonly messages: CodexVoiceSessionMessages;
	private readonly handoff: ControllerHandoff;
	private readonly callbacks: {
		cancelRefresh(): void;
		inputMuted(): boolean;
		notifyMute(muted: boolean): void;
	};
	constructor(
		runtime: VoiceControllerRuntime,
		ownership: ActiveVoiceGuard,
		messages: CodexVoiceSessionMessages,
		handoff: ControllerHandoff,
		callbacks: {
			cancelRefresh(): void;
			inputMuted(): boolean;
			notifyMute(muted: boolean): void;
		},
	) {
		this.runtime = runtime;
		this.ownership = ownership;
		this.messages = messages;
		this.handoff = handoff;
		this.callbacks = callbacks;
	}
	async endCall(session: CodexRealtimeConversation): Promise<void> {
		this.callbacks.cancelRefresh();
		try {
			await session.waitForFinalPlayback();
			if (currentVoiceSession(this.runtime.state) === session)
				await this.stop({ announce: true, finishAcceptedWork: true });
		} catch (error) {
			if (
				currentVoiceSession(this.runtime.state) === session &&
				session.isEndingCall
			)
				this.runtime.context?.ui.notify(
					`Could not finish ending the call: ${error instanceof Error ? error.message : String(error)}. Use Stop to end it now.`,
					"error",
				);
		}
	}

	async stop(options?: {
		finishAcceptedWork?: boolean;
		announce?: boolean;
		transferring?: boolean;
	}): Promise<void> {
		this.handoff.cancelReservation();
		this.callbacks.cancelRefresh();
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		this.runtime.startGeneration += 1;
		const stopGeneration = this.runtime.startGeneration;
		const wasMuted = this.callbacks.inputMuted();
		const endedMode = options?.announce
			? this.runtime.announcedMode
			: undefined;
		const session = currentVoiceSession(this.runtime.state);
		const stoppedPlan = options?.transferring
			? undefined
			: this.runtime.realtimePeerPlan;
		if (!options?.finishAcceptedWork) this.messages.cancelPendingDelegations();
		const forwarded = options?.transferring
			? undefined
			: this.handoff.forwarded;
		if (forwarded) {
			this.handoff.detachForwarded();
		}
		const closePromise = this.ownership.hold(async () => {
			await session?.close(options?.finishAcceptedWork);
		});
		this.runtime.state = { type: "idle" };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		try {
			await Promise.all([
				closePromise,
				this.ownership.hold(async () => {
					await forwarded?.stop();
				}),
			]);
		} finally {
			stoppedPlan?.onStopped?.();
		}
		await this.messages.waitForDelegations();
		if (wasMuted) this.callbacks.notifyMute(false);
		if (this.runtime.startGeneration === stopGeneration)
			this.messages.voiceStopped(endedMode);
	}

	async finishDictation(options?: { announce?: boolean }): Promise<void> {
		this.runtime.startGeneration += 1;
		const session =
			this.runtime.state.type === "dictation"
				? this.runtime.state.session
				: this.runtime.state.type === "connecting" &&
						this.runtime.state.mode === "dictation" &&
						this.runtime.state.phase === "starting"
					? this.runtime.state.session
					: undefined;
		if (!session) {
			await this.stop(options);
			return;
		}
		await this.ownership.hold(() => session.finish());
		if (currentVoiceSession(this.runtime.state) !== session) return;
		const endedMode = options?.announce
			? this.runtime.announcedMode
			: undefined;
		this.runtime.state = { type: "idle" };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.messages.voiceStopped(endedMode);
	}

	fail(
		error: Error,
		failedSession?: CodexRealtimeConversation | undefined,
	): void {
		this.callbacks.cancelRefresh();
		if (
			this.runtime.state.type === "idle" ||
			this.runtime.state.type === "failed"
		)
			return;
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		const mode = voiceModeForState(this.runtime.state);
		const message = this.runtime.config
			? formatVoiceAudioError(error, mode, this.runtime.config)
			: error.message;
		const failGeneration = ++this.runtime.startGeneration;
		const endedMode = this.runtime.announcedMode;
		const wasMuted = this.callbacks.inputMuted();
		const session = currentVoiceSession(this.runtime.state);
		this.messages.cancelPendingDelegations();
		if (failedSession)
			markRealtimePeerInactive(this.runtime, failedSession, error, false);
		const closePromise = this.ownership.hold(async () => {
			await session?.close();
		});
		this.runtime.state = { type: "failed", message };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.runtime.context?.ui.notify(message, "error");
		if (wasMuted) this.callbacks.notifyMute(false);
		void (async () => {
			await Promise.allSettled([closePromise]);
			await Promise.allSettled([this.messages.waitForDelegations()]);
			if (
				this.runtime.startGeneration === failGeneration &&
				this.runtime.state.type === "failed" &&
				this.runtime.state.message === message
			)
				this.messages.voiceStopped(endedMode);
		})();
	}
}
