import { ControllerConnection } from "./controller/connection.ts";
import { ControllerAgent } from "./controller/agent.ts";
import { ControllerState } from "./controller/state.ts";
import type {
	AssistantMessage,
	AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { ActiveVoiceGuard } from "./active-owner.ts";
import { ControllerHandoff } from "./controller/handoff.ts";
import { ControllerLifecycle } from "./controller/lifecycle.ts";
import {
	RealtimeContextRefresh,
	replaceRealtimeContext,
	type RealtimeContextRefreshOptions,
} from "./controller/context.ts";
import {
	type PreparedRealtimeContext,
	type RealtimePeerPlan,
	type VoiceControllerRuntime,
} from "./controller/start.ts";
import {
	currentVoiceSession,
	prepareRealtimeVoicePrompt,
	type VoiceSession,
} from "./controller/support.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CapturedHandoffAudio } from "./handoff-peer.ts";
import type { CodexVoiceSessionMessages } from "./session-messages.ts";
import type { CodexVoiceMode } from "./ui.ts";

export class CodexVoiceController {
	private readonly ownership: ActiveVoiceGuard;
	private readonly runtime: VoiceControllerRuntime = {
		state: { type: "idle" },
		startGeneration: 0,
		voiceStatus: "",
		inputTooQuiet: false,
	};
	private readonly messages: CodexVoiceSessionMessages;
	private readonly agent: ControllerAgent;
	private readonly contextRefresh: RealtimeContextRefresh;
	private readonly presentation: ControllerState;
	private readonly handoff: ControllerHandoff;
	private readonly lifecycle: ControllerLifecycle;
	private readonly connection: ControllerConnection;

	constructor(pi: ExtensionAPI) {
		this.ownership = new ActiveVoiceGuard(
			pi,
			"PCC",
			() => this.active || Boolean(this.handoff.reservation),
		);
		this.handoff = new ControllerHandoff(this.runtime, this.ownership, {
			active: () => this.active,
			status: () => this.status,
			inputMuted: () => this.inputMuted,
			currentSession: () => this.currentSession(),
			setInputMuted: (muted) => this.setInputMuted(muted),
			notifyMute: (muted) => {
				this.presentation.notifyMute(muted);
			},
			renderStatus: (status) => this.presentation.renderStatus(status),
			renderCurrentStatus: () => this.presentation.renderCurrentStatus(),
			stop: (options) => this.stop(options),
		});
		this.presentation = new ControllerState(this.runtime, this.handoff);
		this.agent = new ControllerAgent(pi, this.runtime, () =>
			this.presentation.renderStatus("working"),
		);
		this.messages = this.agent.messages;
		this.contextRefresh = new RealtimeContextRefresh(pi, this.runtime, {
			inputMuted: () => this.inputMuted,
			holdDelegations: () => this.messages.holdDelegationsForRefresh(),
			replace: (ctx, config, previous, plan, inputMuted, prepared, signal) =>
				replaceRealtimeContext({
					runtime: this.runtime,
					ctx,
					config,
					previous,
					plan,
					inputMuted,
					prepared,
					signal,
					callbacks: {
						prepareRealtimePrompt: (ctx) => this.prepareRealtimePrompt(ctx),
						renderStatus: (status) => this.presentation.renderStatus(status),
						fail: (error, previous) => this.lifecycle.fail(error, previous),
						startReplacement: (
							ctx,
							config,
							plan,
							inputMuted,
							prepared,
							signal,
						) =>
							this.connection.start(
								ctx,
								config,
								"realtime",
								plan,
								signal,
								true,
								inputMuted,
								prepared,
							),
					},
				}),
		});
		this.lifecycle = new ControllerLifecycle(
			this.runtime,
			this.ownership,
			this.messages,
			this.handoff,
			{
				cancelRefresh: () => this.contextRefresh.cancel(),
				inputMuted: () => this.inputMuted,
				notifyMute: (muted) => {
					this.presentation.notifyMute(muted);
				},
			},
		);
		this.connection = new ControllerConnection(
			pi,
			this.runtime,
			this.ownership,
			this.messages,
			this.handoff,
			this.lifecycle,
			this.presentation,
			{
				prepareRealtimePrompt: (ctx) => this.prepareRealtimePrompt(ctx),
				stop: (options) => this.stop(options),
				finishDictation: (options) => this.finishDictation(options),
				cancelRefresh: () => this.contextRefresh.cancel(),
			},
		);
	}

	setPrompt(report: { id: string; active: boolean; prompt: string }): void {
		this.presentation.setPrompt(report);
	}

	announceContextTransition(
		reason: "threshold" | "overflow" | "rollover",
	): void {
		if (this.runtime.state.type === "conversation")
			this.runtime.state.session.announceContextTransition(reason);
	}
	compactionStarted(): void {
		this.messages.compactionStarted();
	}
	compactionFinished(): void {
		this.messages.compactionFinished();
	}

	get status(): string {
		return this.presentation.status;
	}
	get active(): boolean {
		return this.presentation.active;
	}
	get activeMode(): CodexVoiceMode | undefined {
		return this.presentation.activeMode;
	}
	get inputMuted(): boolean {
		return this.presentation.inputMuted;
	}
	onInputMuteChange(listener: (muted: boolean) => void): () => void {
		return this.presentation.onInputMuteChange(listener);
	}
	setInputMuted(muted: boolean): boolean {
		return this.presentation.setInputMuted(muted);
	}
	setInputTooQuiet(quiet: boolean): void {
		this.presentation.setInputTooQuiet(quiet);
	}

	resetContextAnnouncements(): void {
		this.messages.resetContextAnnouncements();
	}

	resetSessionContext(): void {
		this.contextRefresh.cancel();
		this.presentation.resetPrompts();
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
		if (this.handoff.reservation)
			throw new Error(
				"A voice transfer is preparing; stop it before starting another call",
			);
		if (this.handoff.forwarded)
			throw new Error(
				"Voice is connected to another session; stop it before starting another call",
			);
		await this.connection.start(ctx, config, mode);
	}

	async startRealtimeWithPeerPlan(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		plan: RealtimePeerPlan,
		signal?: AbortSignal,
		preparedRealtimeContext?: PreparedRealtimeContext,
		inputMuted = false,
		alternateVoice?: boolean,
	): Promise<CodexRealtimeConversation | undefined> {
		if (this.handoff.reservation)
			throw new Error(
				"A voice transfer is preparing; stop it before starting another call",
			);
		if (this.handoff.forwarded && !preparedRealtimeContext)
			throw new Error(
				"Voice is connected to another session; stop it before starting another call",
			);
		return this.connection.start(
			ctx,
			config,
			"realtime",
			plan,
			signal,
			false,
			inputMuted,
			preparedRealtimeContext,
			alternateVoice,
		);
	}

	reserveHandoffArrival(): { signal: AbortSignal; release(): void } {
		return this.handoff.reserveHandoffArrival();
	}
	captureHandoffAudio(): CapturedHandoffAudio {
		return this.handoff.captureHandoffAudio();
	}

	async refreshRealtimeContext(
		ctx: ExtensionContext,
		config: CodexConversionConfig,
		options: RealtimeContextRefreshOptions = {},
	): Promise<void> {
		await this.contextRefresh.run(ctx, config, options);
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

	stop(options?: {
		announce?: boolean;
		transferring?: boolean;
	}): Promise<void> {
		return this.lifecycle.stop(options);
	}
	finishDictation(options?: { announce?: boolean }): Promise<void> {
		return this.lifecycle.finishDictation(options);
	}

	agentStarted(): void {
		this.agent.agentStarted();
	}
	filterContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
		return this.agent.filterContext(messages);
	}
	piInput(input: unknown, streamingBehavior?: "steer" | "followUp"): boolean {
		return this.agent.piInput(input, streamingBehavior);
	}
	piUserMessage(message: unknown): boolean {
		return this.agent.piUserMessage(message);
	}
	streamUpdate(update: AssistantMessageEvent): void {
		this.agent.streamUpdate(update);
	}
	finishAgentMessage(
		message: AssistantMessage,
		forwardReasoningSummaries: boolean,
	): void {
		this.agent.finishAgentMessage(message, forwardReasoningSummaries);
	}
	settleTurn(): void {
		this.agent.settleTurn();
	}

	private currentSession(): VoiceSession | undefined {
		return currentVoiceSession(this.runtime.state);
	}
}
