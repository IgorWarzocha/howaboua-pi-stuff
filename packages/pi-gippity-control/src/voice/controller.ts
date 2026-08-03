import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { GippityControlConfig } from "../config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import { CANCELLED, interruptible } from "./cancellation.ts";
import {
	buildRealtimeInitialItems,
	type RealtimeInitialMessageItem,
} from "./context.ts";
import {
	startControllerConversation,
	startControllerDictation,
} from "./controller-sessions.ts";
import {
	currentVoiceSession,
	prepareRealtimeVoicePrompt,
	renderVoiceStatus,
	VOICE_STATUS_KEY,
	type VoiceSession,
	type VoiceState,
	voiceModeForState,
} from "./controller-support.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
import { formatVoiceAudioError } from "./setup.ts";
import type { CodexVoiceMode } from "./ui.ts";

export class CodexVoiceController {
	private state: VoiceState = { type: "idle" };
	private context: ExtensionContext | undefined;
	private config: GippityControlConfig | undefined;
	private announcedMode: CodexVoiceMode | undefined;
	private startGeneration = 0;
	private startAbortController: AbortController | undefined;
	private readonly messages: CodexVoiceSessionMessages;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();
	private voiceStatus = "";

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.state.type === "conversation",
			onDelegation: (id) => {
				if (this.state.type === "conversation")
					this.state.session.activateDelegation(id);
			},
			onWorking: () => this.renderStatus("working"),
		});
	}

	get status(): string {
		return this.state.type;
	}
	get active(): boolean {
		return this.state.type !== "idle" && this.state.type !== "failed";
	}
	get activeMode(): CodexVoiceMode | undefined {
		return this.announcedMode;
	}
	get inputMuted(): boolean {
		return (
			this.state.type === "conversation" && this.state.session.microphoneMuted
		);
	}
	onInputMuteChange(listener: (muted: boolean) => void): () => void {
		this.inputMuteListeners.add(listener);
		return () => this.inputMuteListeners.delete(listener);
	}
	setInputMuted(muted: boolean): boolean {
		if (this.state.type !== "conversation" || this.announcedMode !== "realtime")
			return false;
		const previous = this.state.session.microphoneMuted;
		this.state.session.setInputMuted(muted);
		const current = this.state.session.microphoneMuted;
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
		config: GippityControlConfig,
		mode: CodexVoiceMode,
	): Promise<void> {
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeer(
		ctx: ExtensionContext,
		config: GippityControlConfig,
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
			if (this.announcedMode === "realtime") return;
			this.announcedMode = "realtime";
			this.messages.modeStarted("realtime");
			return;
		}
		if (session.microphoneMuted) this.setInputMuted(false);
		if (this.announcedMode !== "realtime") return;
		this.announcedMode = undefined;
		this.messages.conversationInputStopped();
	}

	private async startMode(
		ctx: ExtensionContext,
		config: GippityControlConfig,
		mode: CodexVoiceMode,
		peer?: CodexRealtimePeer,
		signal?: AbortSignal,
	): Promise<CodexRealtimeConversation | undefined> {
		if (signal?.aborted) {
			await peer?.close();
			return;
		}
		const realtimePrompt =
			mode === "realtime" ? this.prepareRealtimePrompt(ctx) : undefined;
		if (mode === "realtime" && realtimePrompt === undefined) return;
		if (this.state.type === "dictation")
			await this.finishDictation({ announce: true });
		else await this.stop({ announce: true });
		if (signal?.aborted) {
			await peer?.close();
			return;
		}
		const startAbortController = new AbortController();
		this.startAbortController = startAbortController;
		const startSignal = signal
			? AbortSignal.any([signal, startAbortController.signal])
			: startAbortController.signal;
		const startGeneration = ++this.startGeneration;
		this.context = ctx;
		this.config = config;
		this.messages.setContext(ctx);
		this.state =
			mode === "realtime"
				? { type: "connecting", mode: "realtime", phase: "authorizing" }
				: { type: "connecting", mode: "dictation", phase: "authorizing" };
		this.renderStatus("connecting…");
		try {
			const startup = await interruptible(
				Promise.all([
					resolveCodexVoiceAuth(ctx),
					mode === "realtime"
						? buildRealtimeInitialItems({
								ctx,
								config,
								signal: startSignal,
							})
						: Promise.resolve(undefined),
				]),
				startSignal,
			);
			if (startup === CANCELLED) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			const [auth, initialItems] = startup;
			if (
				startGeneration !== this.startGeneration ||
				this.state.type !== "connecting"
			) {
				await peer?.close();
				return;
			}
			if (mode === "dictation") await this.startDictation(auth, config);
			else
				await this.startConversation(
					auth,
					config,
					realtimePrompt!,
					initialItems,
					peer,
					startSignal,
				);
			if (startSignal.aborted) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			const activeState = this.snapshotState();
			if (mode === "realtime") {
				if (activeState.type !== "conversation") {
					await peer?.close();
					return;
				}
				this.announcedMode = mode;
				this.messages.modeStarted(mode);
				return activeState.session;
			}
			if (activeState.type !== "dictation") return;
			this.announcedMode = mode;
			this.messages.modeStarted(mode);
			return undefined;
		} catch (error) {
			if (startSignal.aborted) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			if (startGeneration !== this.startGeneration) {
				await peer?.close();
				return;
			}
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return undefined;
		}
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.startAbortController?.abort();
		this.startAbortController = undefined;
		this.startGeneration += 1;
		const wasMuted = this.inputMuted;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		const session = this.currentSession();
		const closePromise = session?.close();
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		await closePromise;
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
		this.messages.voiceStopped(endedMode);
	}

	async finishDictation(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const session =
			this.state.type === "dictation"
				? this.state.session
				: this.state.type === "connecting" &&
						this.state.mode === "dictation" &&
						this.state.phase === "starting"
					? this.state.session
					: undefined;
		if (!session) {
			await this.stop(options);
			return;
		}
		await session.finish();
		if (this.currentSession() !== session) return;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
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
			this.state.type === "conversation" &&
			this.state.session.mirrorPiSteer(input)
		);
	}

	streamDelta(type: string, delta: string): void {
		if (this.state.type === "conversation")
			this.state.session.streamAgentDelta(type, delta);
	}

	settleTurn(): void {
		if (this.state.type === "conversation")
			this.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}

	private async startConversation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: GippityControlConfig,
		instructions: string,
		initialItems?: RealtimeInitialMessageItem[],
		peer?: CodexRealtimePeer,
		signal?: AbortSignal,
	): Promise<void> {
		const connecting = this.state;
		if (
			connecting.type !== "connecting" ||
			connecting.mode !== "realtime" ||
			connecting.phase !== "authorizing"
		)
			return;
		await startControllerConversation({
			auth,
			config,
			instructions,
			initialItems,
			peer,
			signal,
			lifecycle: {
				stillAuthorizing: () => this.state === connecting,
				onCreated: (session) => {
					this.state = {
						type: "connecting",
						mode: "realtime",
						phase: "starting",
						session,
					};
				},
				isCurrent: (session) => this.currentSession() === session,
				onActive: (session) => {
					this.state = { type: "conversation", session };
				},
				onError: (session, error) => this.failSession(session, error),
				onStatus: (status) => this.renderStatus(status),
				onTurn: (turn) => this.messages.voiceTurn(turn),
				onTranscriptTail: (transcript) =>
					this.messages.retainTranscriptTail(transcript),
			},
		});
	}

	private async startDictation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: GippityControlConfig,
	): Promise<void> {
		const connecting = this.state;
		if (
			connecting.type !== "connecting" ||
			connecting.mode !== "dictation" ||
			connecting.phase !== "authorizing"
		)
			return;
		await startControllerDictation({
			auth,
			config,
			lifecycle: {
				stillAuthorizing: () => this.state === connecting,
				onCreated: (session) => {
					this.state = {
						type: "connecting",
						mode: "dictation",
						phase: "starting",
						session,
					};
				},
				isCurrent: (session) => this.currentSession() === session,
				onActive: (session) => {
					this.state = { type: "dictation", session };
				},
				onError: (session, error) => this.failSession(session, error),
				onStatus: (status) => this.renderStatus(status),
				onTranscript: (transcript) =>
					this.context?.ui.pasteToEditor(transcript),
			},
		});
	}

	private currentSession(): VoiceSession | undefined {
		return currentVoiceSession(this.state);
	}

	private snapshotState(): VoiceState {
		return this.state;
	}

	private failSession(session: VoiceSession, error: Error): void {
		if (this.currentSession() === session) this.fail(error);
	}

	private cancelStart(startGeneration: number): void {
		if (startGeneration !== this.startGeneration) return;
		this.state = { type: "idle" };
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
	}

	private fail(error: Error): void {
		if (this.state.type === "idle" || this.state.type === "failed") return;
		this.startAbortController?.abort();
		this.startAbortController = undefined;
		const mode = voiceModeForState(this.state);
		const message = this.config
			? formatVoiceAudioError(error, mode, this.config)
			: error.message;
		this.startGeneration += 1;
		const endedMode = this.announcedMode;
		const wasMuted = this.inputMuted;
		const session = this.currentSession();
		const closePromise = session?.close();
		this.state = { type: "failed", message };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus(VOICE_STATUS_KEY, undefined);
		this.context?.ui.notify(message, "error");
		this.messages.voiceStopped(endedMode);
		if (wasMuted)
			for (const listener of this.inputMuteListeners) listener(false);
		void closePromise;
	}

	private renderStatus(status: string): void {
		this.voiceStatus = status;
		this.renderCurrentStatus();
	}

	private renderCurrentStatus(): void {
		renderVoiceStatus(this.context, this.voiceStatus, this.inputMuted);
	}
}
