import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import {
	startControllerMode,
	type RealtimePeerPlan,
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
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import { completedVoiceReasoningSummary } from "./reasoning-summary.ts";
import { CodexVoiceSessionMessages, type PreparedVoiceDelegation } from "./session-messages.ts";
import { formatVoiceAudioError } from "./setup.ts";
import type { CodexVoiceMode } from "./ui.ts";

export class CodexVoiceController {
	private readonly runtime: VoiceControllerRuntime = {
		state: { type: "idle" },
		startGeneration: 0,
		voiceStatus: "",
		inputTooQuiet: false,
	};
	private readonly messages: CodexVoiceSessionMessages;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();
	private readonly activePrompts = new Map<string, string>();
	private delegationPreflight: (ctx: ExtensionContext, signal: AbortSignal) => Promise<PreparedVoiceDelegation | undefined> = async () => undefined;

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.runtime.state.type === "conversation",
			prepareDelegation: (ctx, signal) => this.delegationPreflight(ctx, signal),
			onDelegation: (id) => {
				if (this.runtime.state.type === "conversation")
					this.runtime.state.session.activateDelegation(id);
			},
			onDelegationFailed: () => {
				if (this.runtime.state.type === "conversation")
					this.runtime.state.session.settleAgentTurn();
			},
			onWorking: () => this.renderStatus("working"),
		});
	}

	setDelegationPreflight(preflight: (ctx: ExtensionContext, signal: AbortSignal) => Promise<PreparedVoiceDelegation | undefined>): void {
		this.delegationPreflight = preflight;
	}

	setPrompt(report: { id: string; active: boolean; prompt: string }): void {
		if (!report.active) {
			this.activePrompts.delete(report.id);
			return;
		}
		if (this.activePrompts.get(report.id) === report.prompt) return;
		this.activePrompts.delete(report.id);
		this.activePrompts.set(report.id, report.prompt);
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.announcePrompt(report.prompt);
	}
	announceCompactionStart(reason: "threshold" | "overflow"): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.announceCompactionStart(reason);
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
	setInputTooQuiet(inputTooQuiet: boolean): void {
		const receivesInput =
			this.runtime.state.type === "conversation" ||
			this.runtime.state.type === "reconnecting" ||
			this.runtime.state.type === "connecting";
		const next = receivesInput && inputTooQuiet;
		if (this.runtime.inputTooQuiet === next) return;
		this.runtime.inputTooQuiet = next;
		this.renderCurrentStatus();
	}
	resetContextAnnouncements(): void {
		this.messages.resetContextAnnouncements();
	}

	resetSessionContext(): void {
		this.activePrompts.clear();
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

	async startRealtimeWithPeerPlan(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		plan: RealtimePeerPlan,
		signal?: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", plan, signal);
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

	async stopRealtimeWithPeerPlan(
		plan: RealtimePeerPlan,
		options?: { announce?: boolean },
	): Promise<void> {
		if (this.runtime.realtimePeerPlan === plan) await this.stop(options);
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
		realtimePeerPlan?: RealtimePeerPlan,
		signal?: AbortSignal,
		resume = false,
		inputMuted = false,
	): Promise<CodexRealtimeConversation | undefined> {
		const session = await startControllerMode({
			runtime: this.runtime,
			messages: this.messages,
			ctx,
			config,
			mode,
			realtimePeerPlan,
			signal,
			resume,
			inputMuted,
			prepareRealtimePrompt: (current) => this.prepareRealtimePrompt(current),
			stopCurrent: () => this.stop({ announce: true }),
			finishCurrentDictation: () => this.finishDictation({ announce: true }),
			onError: (error, session) => this.fail(error, session),
			onDrop: (session, error) => this.drop(session, error),
			onStatus: (status) => this.renderStatus(status),
		});
		const activePrompt = Array.from(this.activePrompts.values()).at(-1);
		if (session && activePrompt) session.announcePrompt(activePrompt);
		return session;
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		this.runtime.startGeneration += 1;
		const stopGeneration = this.runtime.startGeneration;
		const wasMuted = this.inputMuted;
		const endedMode = options?.announce
			? this.runtime.announcedMode
			: undefined;
		const session = this.currentSession();
		const closePromise = session?.close();
		this.runtime.state = { type: "idle" };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		await closePromise;
		this.messages.cancelPendingDelegations();
		await this.messages.waitForDelegations();
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
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
		await session.finish();
		if (this.currentSession() !== session) return;
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

	finishAgentMessage(
		message: AssistantMessage,
		forwardReasoningSummaries: boolean,
	): void {
		if (this.runtime.state.type !== "conversation") return;
		const channel = realtimeHandoffChannel(message.stopReason);
		const completedText = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		if (this.runtime.state.session.agentProgressStreamed) {
			this.runtime.state.session.finishAgentProgress();
			return;
		}
		if (channel === "commentary") {
			if (completedText.trim()) {
				this.runtime.state.session.finishAgentProgress(completedText);
			} else if (forwardReasoningSummaries) {
				this.runtime.state.session.finishAgentMessage(
					"speakable",
					completedVoiceReasoningSummary(message),
				);
			}
			return;
		}
		this.runtime.state.session.finishAgentMessage(channel, completedText);
	}

	settleTurn(): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}

	private currentSession(): VoiceSession | undefined {
		return currentVoiceSession(this.runtime.state);
	}

	private fail(
		error: Error,
		failedSession?: CodexRealtimeConversation | undefined,
	): void {
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
		const wasMuted = this.inputMuted;
		const session = this.currentSession();
		if (failedSession)
			this.markRealtimePeerInactive(failedSession, error, false);
		const closePromise = session?.close();
		this.runtime.state = { type: "failed", message };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.runtime.context?.ui.notify(message, "error");
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
		void (async () => {
			await Promise.allSettled([closePromise]);
			this.messages.cancelPendingDelegations();
			await Promise.allSettled([this.messages.waitForDelegations()]);
			if (
				this.runtime.startGeneration === failGeneration &&
				this.runtime.state.type === "failed" &&
				this.runtime.state.message === message
			) this.messages.voiceStopped(endedMode);
		})();
	}

	private drop(session: CodexRealtimeConversation, error: Error): void {
		if (this.currentSession() !== session) return;
		const config = this.runtime.config;
		const ctx = this.runtime.context;
		if (!config?.voice.autoResumeRealtime || !ctx) {
			this.markRealtimePeerInactive(session, error, false);
			this.fail(error);
			return;
		}
		const realtimePeerPlan = this.runtime.realtimePeerPlan;
		this.markRealtimePeerInactive(session, error, true);
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		const resumeGeneration = ++this.runtime.startGeneration;
		const wasMuted = this.inputMuted;
		this.runtime.state = { type: "reconnecting", session };
		this.renderStatus("reconnecting…");
		void (async () => {
			await Promise.allSettled([
				session.close(),
				this.messages.waitForDelegations(),
			]);
			if (
				this.runtime.startGeneration !== resumeGeneration ||
				this.runtime.state.type !== "reconnecting"
			) return;
			const resumePromise = this.startMode(
				ctx,
				config,
				"realtime",
				realtimePeerPlan,
				undefined,
				true,
				wasMuted,
			);
			const replacementGeneration = this.runtime.startGeneration;
			let resumed: CodexRealtimeConversation | undefined;
			try {
				resumed = await resumePromise;
			} catch (resumeError) {
				if (this.runtime.startGeneration === replacementGeneration)
					this.fail(
						resumeError instanceof Error
							? resumeError
							: new Error(String(resumeError)),
					);
				return;
			}
			if (!resumed) {
				const resumeError = new Error("Codex realtime voice could not resume");
				this.markRealtimePeerInactive(
					session,
					resumeError,
					false,
					realtimePeerPlan,
				);
				if (this.runtime.state.type === "reconnecting")
					this.fail(resumeError);
				return;
			}
			if (resumed && wasMuted && this.currentSession() === resumed)
				this.renderCurrentStatus();
		})();
	}

	private markRealtimePeerInactive(
		session: CodexRealtimeConversation,
		error: Error,
		resuming: boolean,
		plan = this.runtime.realtimePeerPlan,
	): void {
		try {
			plan?.onInactive?.(session, error, resuming);
		} catch (ownerError) {
			this.runtime.context?.ui.notify(
				`Could not update realtime voice owner: ${ownerError instanceof Error ? ownerError.message : String(ownerError)}`,
				"error",
			);
		}
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
			this.runtime.inputTooQuiet,
		);
	}
}
