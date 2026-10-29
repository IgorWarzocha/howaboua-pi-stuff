import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../../adapter/activation/config.ts";
import type { ActiveVoiceGuard } from "../active-owner.ts";
import {
	startControllerMode,
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
	type VoiceControllerRuntime,
} from "./start.ts";
import { resumeDroppedConversation } from "./reconnect.ts";
import { currentVoiceSession } from "./support.ts";
import type { CodexRealtimeConversation } from "../conversation/session.ts";
import type { CodexVoiceSessionMessages } from "../session-messages.ts";
import type { CodexVoiceMode } from "../ui.ts";
import type { ControllerHandoff } from "./handoff.ts";
import type { ControllerLifecycle } from "./lifecycle.ts";
import type { ControllerState } from "./state.ts";
interface ConnectionCallbacks {
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined;
	stop(options: { announce: boolean; transferring: boolean }): Promise<void>;
	finishDictation(options: { announce: boolean }): Promise<void>;
	cancelRefresh(): void;
}
/** Binds startup and reconnect to the same mode, ownership and presentation authorities. */
export class ControllerConnection {
	private readonly pi: ExtensionAPI;
	private readonly runtime: VoiceControllerRuntime;
	private readonly ownership: ActiveVoiceGuard;
	private readonly messages: CodexVoiceSessionMessages;
	private readonly handoff: ControllerHandoff;
	private readonly lifecycle: ControllerLifecycle;
	private readonly presentation: ControllerState;
	private readonly callbacks: ConnectionCallbacks;
	constructor(
		pi: ExtensionAPI,
		runtime: VoiceControllerRuntime,
		ownership: ActiveVoiceGuard,
		messages: CodexVoiceSessionMessages,
		handoff: ControllerHandoff,
		lifecycle: ControllerLifecycle,
		presentation: ControllerState,
		callbacks: ConnectionCallbacks,
	) {
		this.pi = pi;
		this.runtime = runtime;
		this.ownership = ownership;
		this.messages = messages;
		this.handoff = handoff;
		this.lifecycle = lifecycle;
		this.presentation = presentation;
		this.callbacks = callbacks;
	}
	async start(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		mode: CodexVoiceMode,
		realtimePeerPlan?: RealtimePeerPlan,
		signal?: AbortSignal,
		resume = false,
		inputMuted = false,
		preparedRealtimeContext?: PreparedRealtimeContext,
		alternateVoice?: boolean,
	): Promise<CodexRealtimeConversation | undefined> {
		return this.ownership.start(async () => {
			const session = await startControllerMode({
				pi: this.pi,
				runtime: this.runtime,
				messages: this.messages,
				ctx,
				config,
				mode,
				realtimePeerPlan,
				signal,
				resume,
				inputMuted,
				alternateVoice,
				...(preparedRealtimeContext ? { preparedRealtimeContext } : {}),
				prepareRealtimePrompt: (current) =>
					this.callbacks.prepareRealtimePrompt(current),
				stopCurrent: () =>
					this.callbacks.stop({
						announce: true,
						transferring: Boolean(
							preparedRealtimeContext && this.handoff.forwarded,
						),
					}),
				finishCurrentDictation: () =>
					this.callbacks.finishDictation({ announce: true }),
				onError: (error, session) => this.lifecycle.fail(error, session),
				onDrop: (session, error) => this.drop(session, error),
				onEndCall: (session) => { void this.lifecycle.endCall(session); },
				onStatus: (status) => this.presentation.renderStatus(status),
			});
			const activePrompt = this.presentation.activePrompt;
			if (session && activePrompt) session.announcePrompt(activePrompt);
			return session;
		});
	}

	drop(session: CodexRealtimeConversation, error: Error): void {
		this.callbacks.cancelRefresh();
		resumeDroppedConversation({
			runtime: this.runtime,
			messages: this.messages,
			session,
			error,
			callbacks: {
				currentSession: () => currentVoiceSession(this.runtime.state),
				fail: (failure) => this.lifecycle.fail(failure),
				inputMuted: () => this.presentation.inputMuted,
				renderCurrentStatus: () => this.presentation.renderCurrentStatus(),
				renderStatus: (status) => this.presentation.renderStatus(status),
				startReplacement: (ctx, config, plan, inputMuted) =>
					this.start(
						ctx,
						config,
						"realtime",
						plan,
						undefined,
						true,
						inputMuted,
					),
			},
		});
	}
}
