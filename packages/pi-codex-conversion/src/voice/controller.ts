import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import {
	startControllerMode,
	type VoiceControllerRuntime,
} from "./controller-start.ts";
import {
	currentVoiceSession,
	prepareRealtimeVoicePrompt,
	renderVoiceStatus,
	VOICE_STATUS_KEY,
	type VoiceSession,
	voiceModeForState,
} from "./controller-support.ts";
import { realtimeHandoffChannel } from "./conversation/handoff.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
import { formatVoiceAudioError } from "./setup.ts";
import type { CodexVoiceMode } from "./ui.ts";

export class CodexVoiceController {
	private readonly runtime: VoiceControllerRuntime = {
		state: { type: "idle" },
		startGeneration: 0,
		voiceStatus: "",
	};
	private readonly messages: CodexVoiceSessionMessages;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.runtime.state.type === "conversation",
			onDelegation: (id) => {
				if (this.runtime.state.type === "conversation")
					this.runtime.state.session.activateDelegation(id);
			},
			onWorking: () => this.renderStatus("working"),
		});
	}

	get status(): string {
		return this.runtime.state.type;
	}
	get active(): boolean {
		return (
			this.runtime.state.type !== "idle" && this.runtime.state.type !== "failed"
		);
	}
	get activeMode(): CodexVoiceMode | undefined {
		return this.runtime.announcedMode;
	}
	get inputMuted(): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.microphoneMuted
		);
	}
	onInputMuteChange(listener: (muted: boolean) => void): () => void {
		this.inputMuteListeners.add(listener);
		return () => this.inputMuteListeners.delete(listener);
	}
	setInputMuted(muted: boolean): boolean {
		if (
			this.runtime.state.type !== "conversation" ||
			this.runtime.announcedMode !== "realtime"
		)
			return false;
		const previous = this.runtime.state.session.microphoneMuted;
		this.runtime.state.session.setInputMuted(muted);
		const current = this.runtime.state.session.microphoneMuted;
		if (previous !== current) {
			this.renderCurrentStatus();
			for (const listener of this.inputMuteListeners) listener(current);
		}
		return true;
	}
	resetContextAnnouncements(): void {
		this.messages.resetContextAnnouncements();
	}

	resetSessionContext(): void {
		this.messages.resetSessionContext();
	}
	announceDictation(ctx: ExtensionContext): void {
		this.messages.setContext(ctx);
		this.messages.modeStarted("dictation");
	}

	async start(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		mode: CodexVoiceMode,
	): Promise<void> {
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeer(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		peer: CodexRealtimePeer,
		signal?: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", peer, signal);
	}
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined {
		return prepareRealtimeVoicePrompt(ctx);
	}

	async stopConversation(
		session: CodexRealtimeConversation,
		options?: { announce?: boolean },
	): Promise<void> {
		if (this.currentSession() === session) await this.stop(options);
	}

	setConversationInputActive(
		session: CodexRealtimeConversation,
		active: boolean,
	): void {
		if (this.currentSession() !== session) return;
		if (active) {
			if (this.runtime.announcedMode === "realtime") return;
			this.runtime.announcedMode = "realtime";
			this.messages.modeStarted("realtime");
			return;
		}
		if (session.microphoneMuted) this.setInputMuted(false);
		if (this.runtime.announcedMode !== "realtime") return;
		this.runtime.announcedMode = undefined;
		this.messages.conversationInputStopped();
	}

	private async startMode(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		mode: CodexVoiceMode,
		peer?: CodexRealtimePeer,
		signal?: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined> {
		return startControllerMode({
			runtime: this.runtime,
			messages: this.messages,
			ctx,
			config,
			mode,
			peer,
			signal,
			prepareRealtimePrompt: (current) => this.prepareRealtimePrompt(current),
			stopCurrent: () => this.stop({ announce: true }),
			finishCurrentDictation: () => this.finishDictation({ announce: true }),
			onError: (error) => this.fail(error),
			onStatus: (status) => this.renderStatus(status),
		});
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		this.runtime.startGeneration += 1;
		const wasMuted = this.inputMuted;
		const endedMode = options?.announce
			? this.runtime.announcedMode
			: undefined;
		const session = this.currentSession();
		const closePromise = session?.close();
		this.runtime.state = { type: "idle" };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		await closePromise;
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
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
		await session.finish();
		if (this.currentSession() !== session) return;
		const endedMode = options?.announce
			? this.runtime.announcedMode
			: undefined;
		this.runtime.state = { type: "idle" };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.messages.voiceStopped(endedMode);
	}

	agentStarted(): void {
		this.messages.agentStarted();
	}

	filterContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
		return this.messages.filterContext(messages);
	}

	mirrorPiSteer(input: unknown): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.mirrorPiSteer(input)
		);
	}

	streamDelta(delta: string): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.streamAgentDelta(delta);
	}

	finishAgentMessage(stopReason: AssistantMessage["stopReason"]): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.finishAgentMessage(
				realtimeHandoffChannel(stopReason),
			);
	}

	settleTurn(): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}

	private currentSession(): VoiceSession | undefined {
		return currentVoiceSession(this.runtime.state);
	}

	private fail(error: Error): void {
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
		this.runtime.startGeneration += 1;
		const endedMode = this.runtime.announcedMode;
		const wasMuted = this.inputMuted;
		const session = this.currentSession();
		const closePromise = session?.close();
		this.runtime.state = { type: "failed", message };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.runtime.context?.ui.notify(message, "error");
		this.messages.voiceStopped(endedMode);
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
		void closePromise;
	}

	private renderStatus(status: string): void {
		this.runtime.voiceStatus = status;
		this.renderCurrentStatus();
	}

	private renderCurrentStatus(): void {
		renderVoiceStatus(
			this.runtime.context,
			this.runtime.voiceStatus,
			this.inputMuted,
		);
	}
}
