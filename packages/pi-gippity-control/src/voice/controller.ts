import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../config.ts";
import { RealtimeCompactionRefresh } from "./controller-compaction.ts";
import {
	markRealtimePeerInactive,
	resumeDroppedConversation,
} from "./controller-reconnect.ts";
import {
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
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
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import { completedVoiceReasoningSummary } from "./reasoning-summary.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
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
	private readonly compactionRefresh: RealtimeCompactionRefresh;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();
	private readonly activePrompts = new Map<string, string>();

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.runtime.state.type === "conversation",
			onDelegation: (id) => {
				if (this.runtime.state.type === "conversation")
					this.runtime.state.session.activateDelegation(id);
			},
			onWorking: () => this.renderStatus("working"),
		});
		this.compactionRefresh = new RealtimeCompactionRefresh(this.runtime, {
			inputMuted: () => this.inputMuted,
			replace: (ctx, config, previous, plan, inputMuted, prepared, signal) =>
				this.replaceRealtimeAfterCompaction(
					ctx,
					config,
					previous,
					plan,
					inputMuted,
					prepared,
					signal,
				),
		});
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
		this.compactionRefresh.cancel();
		this.activePrompts.clear();
		this.messages.resetSessionContext();
	}
	announceDictation(ctx: ExtensionContext): void {
		this.messages.setContext(ctx);
		this.messages.modeStarted("dictation");
	}

	async start(
		ctx: ExtensionContext,
		config: GippityControlConfig,
		mode: CodexVoiceMode,
	): Promise<void> {
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeerPlan(
		ctx: ExtensionContext,
		config: GippityControlConfig,
		plan: RealtimePeerPlan,
		signal?: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", plan, signal);
	}

	async refreshRealtimeAfterCompaction(
		ctx: ExtensionContext,
		config: GippityControlConfig,
	): Promise<void> {
		await this.compactionRefresh.run(ctx, config);
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
		config: GippityControlConfig,
		mode: CodexVoiceMode,
		realtimePeerPlan?: RealtimePeerPlan,
		signal?: AbortSignal,
		resume = false,
		inputMuted = false,
		preparedRealtimeContext?: PreparedRealtimeContext,
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
			...(preparedRealtimeContext ? { preparedRealtimeContext } : {}),
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
		this.compactionRefresh.cancel();
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
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
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

	piInput(input: unknown, streamingBehavior?: "steer" | "followUp"): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.piInput(input, streamingBehavior)
		);
	}

	piUserMessage(message: unknown): boolean {
		return (
			this.runtime.state.type === "conversation" &&
			this.runtime.state.session.piUserMessage(message)
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
		const completedText = message.content
			.flatMap((part) => (part.type === "text" ? [part.text] : []))
			.join("\n");
		if (message.stopReason === "toolUse") {
			const progress = completedText.trim()
				? completedText
				: forwardReasoningSummaries
					? completedVoiceReasoningSummary(message)
					: undefined;
			if (progress) this.runtime.state.session.agentProgress(progress);
			return;
		}
		this.runtime.state.session.agentResult(completedText);
	}

	settleTurn(): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}

	private currentSession(): VoiceSession | undefined {
		return currentVoiceSession(this.runtime.state);
	}

	private async replaceRealtimeAfterCompaction(
		ctx: ExtensionContext,
		config: GippityControlConfig,
		previous: CodexRealtimeConversation,
		plan: RealtimePeerPlan | undefined,
		inputMuted: boolean,
		prepared: PreparedRealtimeContext,
		signal: AbortSignal,
	): Promise<void> {
		if (!this.prepareRealtimePrompt(ctx))
			throw new Error("Realtime voice prompt is unavailable");
		this.runtime.startAbortController?.abort();
		this.runtime.startAbortController = undefined;
		markRealtimePeerInactive(
			this.runtime,
			previous,
			new Error("Realtime voice refreshed after compaction"),
			true,
			plan,
		);
		const generation = ++this.runtime.startGeneration;
		this.runtime.state = { type: "reconnecting", session: previous };
		this.renderStatus("reconnecting…");
		plan?.onStatus?.("reconnecting…");
		await previous.close();
		if (
			signal.aborted ||
			this.runtime.startGeneration !== generation ||
			this.runtime.state.type !== "reconnecting"
		)
			return;
		const replacement = await this.startMode(
			ctx,
			config,
			"realtime",
			plan,
			signal,
			true,
			inputMuted,
			prepared,
		);
		if (
			!replacement &&
			!signal.aborted &&
			this.runtime.state.type === "reconnecting"
		)
			this.fail(new Error("Codex realtime voice could not refresh"), previous);
	}

	private fail(
		error: Error,
		failedSession?: CodexRealtimeConversation | undefined,
	): void {
		this.compactionRefresh.cancel();
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
		if (failedSession)
			markRealtimePeerInactive(this.runtime, failedSession, error, false);
		const closePromise = session?.close();
		this.runtime.state = { type: "failed", message };
		this.runtime.announcedMode = undefined;
		this.runtime.config = undefined;
		this.runtime.realtimePeerPlan = undefined;
		this.runtime.voiceStatus = "";
		this.runtime.inputTooQuiet = false;
		this.runtime.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.runtime.context?.ui.notify(message, "error");
		this.messages.voiceStopped(endedMode);
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
		void Promise.allSettled([closePromise]);
	}

	private drop(session: CodexRealtimeConversation, error: Error): void {
		this.compactionRefresh.cancel();
		resumeDroppedConversation({
			runtime: this.runtime,
			session,
			error,
			callbacks: {
				currentSession: () => this.currentSession(),
				fail: (failure) => this.fail(failure),
				inputMuted: () => this.inputMuted,
				renderCurrentStatus: () => this.renderCurrentStatus(),
				renderStatus: (status) => this.renderStatus(status),
				startReplacement: (ctx, config, plan, inputMuted) =>
					this.startMode(
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
