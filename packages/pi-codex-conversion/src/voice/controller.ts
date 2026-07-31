import type { ContextEvent, ExtensionAPI, ExtensionContext, InputEvent, MessageStartEvent } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import { CANCELLED, interruptible } from "./cancellation.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexDictationSession } from "./dictation/session.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
import { formatVoiceAudioError } from "./setup.ts";
import {
	formatCodexVoicePromptSchemaMismatch,
	getProjectCodexVoiceSystemPromptPath,
	loadCodexVoiceSystemPrompt,
	prepareCodexVoiceSystemPrompt,
} from "./system-prompt.ts";
import type { CodexVoiceMode } from "./ui.ts";

type VoiceSession = CodexRealtimeConversation | CodexDictationSession;
type VoiceState =
	| { type: "idle" }
	| { type: "connecting"; mode: "realtime"; phase: "authorizing" }
	| { type: "connecting"; mode: "realtime"; phase: "starting"; session: CodexRealtimeConversation }
	| { type: "connecting"; mode: "dictation"; phase: "authorizing" }
	| { type: "connecting"; mode: "dictation"; phase: "starting"; session: CodexDictationSession }
	| { type: "conversation"; session: CodexRealtimeConversation }
	| { type: "dictation"; session: CodexDictationSession }
	| { type: "failed"; message: string };

export class CodexVoiceController {
	private state: VoiceState = { type: "idle" };
	private context: ExtensionContext | undefined;
	private config: CodexConversionConfig | undefined;
	private announcedMode: CodexVoiceMode | undefined;
	private startGeneration = 0;
	private readonly messages: CodexVoiceSessionMessages;
	private readonly inputMuteListeners = new Set<(muted: boolean) => void>();
	private voiceStatus = "";

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.state.type === "conversation",
			onDelegation: (id) => { if (this.state.type === "conversation") this.state.session.activateDelegation(id); },
			onWorking: () => this.renderStatus("working"),
		});
	}

	get status(): string { return this.state.type; }
	get active(): boolean { return this.state.type !== "idle" && this.state.type !== "failed"; }
	get activeMode(): CodexVoiceMode | undefined { return this.announcedMode; }
	get inputMuted(): boolean { return this.state.type === "conversation" && this.state.session.microphoneMuted; }
	onInputMuteChange(listener: (muted: boolean) => void): () => void {
		this.inputMuteListeners.add(listener);
		return () => this.inputMuteListeners.delete(listener);
	}
	setInputMuted(muted: boolean): boolean {
		if (this.state.type !== "conversation" || this.announcedMode !== "realtime") return false;
		const previous = this.state.session.microphoneMuted;
		this.state.session.setInputMuted(muted);
		const current = this.state.session.microphoneMuted;
		if (previous !== current) {
			this.renderCurrentStatus();
			for (const listener of this.inputMuteListeners) listener(current);
		}
		return true;
	}
	resetContextAnnouncements(): void { this.messages.resetContextAnnouncements(); }
	resetSessionContext(): void { this.messages.resetSessionContext(); }
	announceDictation(ctx: ExtensionContext): void {
		this.messages.setContext(ctx);
		this.messages.modeStarted("dictation");
	}

	async start(ctx: ExtensionContext, config: CodexConversionConfig, mode: CodexVoiceMode): Promise<void> {
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeer(ctx: ExtensionContext, config: CodexConversionConfig, peer: CodexRealtimePeer, signal?: AbortSignal): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", peer, signal);
	}
	prepareRealtimePrompt(ctx: ExtensionContext): string | undefined {
		try {
			const status = prepareCodexVoiceSystemPrompt();
			if (!status.current) ctx.ui.notify(formatCodexVoicePromptSchemaMismatch(status.currentSchemaVersion), "warning");
			return loadCodexVoiceSystemPrompt(undefined, ctx.isProjectTrusted() ? getProjectCodexVoiceSystemPromptPath(ctx.cwd) : undefined);
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return undefined;
		}
	}

	async stopConversation(session: CodexRealtimeConversation, options?: { announce?: boolean }): Promise<void> {
		if (this.currentSession() === session) await this.stop(options);
	}

	setConversationInputActive(session: CodexRealtimeConversation, active: boolean): void {
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

	private async startMode(ctx: ExtensionContext, config: CodexConversionConfig, mode: CodexVoiceMode, peer?: CodexRealtimePeer, signal?: AbortSignal): Promise<CodexRealtimeConversation | undefined> {
		if (signal?.aborted) { await peer?.close(); return; }
		const realtimePrompt = mode === "realtime" ? this.prepareRealtimePrompt(ctx) : undefined;
		if (mode === "realtime" && realtimePrompt === undefined) return;
		if (this.state.type === "dictation") await this.finishDictation({ announce: true });
		else await this.stop({ announce: true });
		if (signal?.aborted) { await peer?.close(); return; }
		const startGeneration = ++this.startGeneration;
		this.context = ctx;
		this.config = config;
		this.messages.setContext(ctx);
		this.state = mode === "realtime"
			? { type: "connecting", mode: "realtime", phase: "authorizing" }
			: { type: "connecting", mode: "dictation", phase: "authorizing" };
		this.renderStatus("connecting…");
		try {
			const auth = await interruptible(resolveCodexVoiceAuth(ctx), signal);
			if (auth === CANCELLED) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			if (startGeneration !== this.startGeneration || this.state.type !== "connecting") { await peer?.close(); return; }
			if (mode === "dictation") await this.startDictation(auth, config);
			else await this.startConversation(auth, config, realtimePrompt!, peer, signal);
			if (signal?.aborted) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			const activeState = this.snapshotState();
			if (mode === "realtime") {
				if (activeState.type !== "conversation") { await peer?.close(); return; }
				this.announcedMode = mode;
				this.messages.modeStarted(mode);
				return activeState.session;
			}
			if (activeState.type !== "dictation") return;
			this.announcedMode = mode;
			this.messages.modeStarted(mode);
			return undefined;
		} catch (error) {
			if (signal?.aborted) {
				await peer?.close();
				this.cancelStart(startGeneration);
				return;
			}
			if (startGeneration !== this.startGeneration) { await peer?.close(); return; }
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return undefined;
		}
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const wasMuted = this.inputMuted;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		const session = this.currentSession();
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus("codex-voice", undefined);
		await session?.close();
		if (wasMuted) for (const listener of this.inputMuteListeners) listener(false);
		this.messages.voiceStopped(endedMode);
	}

	async finishDictation(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const session = this.state.type === "dictation"
			? this.state.session
			: this.state.type === "connecting" && this.state.mode === "dictation" && this.state.phase === "starting"
				? this.state.session
				: undefined;
		if (!session) { await this.stop(options); return; }
		await session.finish();
		if (this.currentSession() !== session) return;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus("codex-voice", undefined);
		this.messages.voiceStopped(endedMode);
	}

	consumeDelegatedTurnStart(): boolean {
		return this.messages.consumeDelegatedTurnStart();
	}

	agentStarted(): void {
		this.messages.agentStarted();
	}

	bindDelegatedUserMessage(message: MessageStartEvent["message"]): void { this.messages.bindDelegatedUserMessage(message); }
	acceptDelegatedInput(event: InputEvent): void { this.messages.acceptDelegatedInput(event); }

	applyDelegationContext(messages: ContextEvent["messages"]): ContextEvent["messages"] { return this.messages.applyDelegationContext(messages); }

	mirrorPiSteer(input: unknown): boolean {
		return this.state.type === "conversation" && this.state.session.mirrorPiSteer(input);
	}

	streamDelta(type: string, delta: string): void {
		if (this.state.type === "conversation") this.state.session.streamAgentDelta(type, delta);
	}

	settleTurn(): void {
		if (this.state.type === "conversation") this.state.session.settleAgentTurn();
		this.messages.agentSettled();
	}

	private async startConversation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: CodexConversionConfig,
		instructions: string,
		peer?: CodexRealtimePeer,
		signal?: AbortSignal,
	): Promise<void> {
		const connecting = this.state;
		if (connecting.type !== "connecting" || connecting.mode !== "realtime" || connecting.phase !== "authorizing") return;
		if (signal?.aborted) { await peer?.close(); return; }
		const { CodexRealtimeConversation } = await import("./conversation/session.ts");
		if (this.state !== connecting || signal?.aborted) { await peer?.close(); return; }
		const realtimePeer = peer ?? new (await import("./conversation/native-peer.ts")).NativeCodexRealtimePeer();
		if (this.state !== connecting || signal?.aborted) { await realtimePeer.close(); return; }
		let session!: CodexRealtimeConversation;
		session = new CodexRealtimeConversation({
			onError: (error) => this.failSession(session, error),
			onStatus: (status) => this.renderStatus(status),
				onTurn: (turn) => this.messages.voiceTurn(turn),
				onTranscriptTail: (transcript) => this.messages.retainTranscriptTail(transcript),
		}, realtimePeer);
		this.state = { type: "connecting", mode: "realtime", phase: "starting", session };
		if (signal?.aborted) { await session.close(); return; }
		const closeOnAbort = () => { void session.close(); };
		signal?.addEventListener("abort", closeOnAbort, { once: true });
		try {
			await session.start(auth, config, instructions);
		} finally {
			signal?.removeEventListener("abort", closeOnAbort);
		}
		if (this.currentSession() === session) this.state = { type: "conversation", session };
		else await session.close();
	}

	private async startDictation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: CodexConversionConfig,
	): Promise<void> {
		const connecting = this.state;
		if (connecting.type !== "connecting" || connecting.mode !== "dictation" || connecting.phase !== "authorizing") return;
		const { CodexDictationSession } = await import("./dictation/session.ts");
		if (this.state !== connecting) return;
		let session!: CodexDictationSession;
		session = new CodexDictationSession({
			onError: (error) => this.failSession(session, error),
			onStatus: (status) => this.renderStatus(status),
			onTranscript: (transcript) => { this.context?.ui.pasteToEditor(transcript); },
		});
		this.state = { type: "connecting", mode: "dictation", phase: "starting", session };
		await session.start(auth, config);
		if (this.currentSession() === session) this.state = { type: "dictation", session };
		else await session.close();
	}

	private currentSession(): VoiceSession | undefined {
		if (this.state.type === "conversation" || this.state.type === "dictation") return this.state.session;
		return this.state.type === "connecting" && this.state.phase === "starting" ? this.state.session : undefined;
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
		this.context?.ui.setStatus("codex-voice", undefined);
	}

	private fail(error: Error): void {
		if (this.state.type === "idle" || this.state.type === "failed") return;
		const mode = this.state.type === "connecting"
			? this.state.mode
			: this.state.type === "dictation" ? "dictation" : "realtime";
		const message = this.config ? formatVoiceAudioError(error, mode, this.config) : error.message;
		this.startGeneration += 1;
		const endedMode = this.announcedMode;
		const wasMuted = this.inputMuted;
		const session = this.currentSession();
		this.state = { type: "failed", message };
		this.announcedMode = undefined;
		this.config = undefined;
		this.voiceStatus = "";
		this.context?.ui.setStatus("codex-voice", undefined);
		this.context?.ui.notify(message, "error");
		this.messages.voiceStopped(endedMode);
		if (wasMuted) for (const listener of this.inputMuteListeners) listener(false);
		void session?.close();
	}

	private renderStatus(status: string): void {
		this.voiceStatus = status;
		this.renderCurrentStatus();
	}

	private renderCurrentStatus(): void {
		const ctx = this.context;
		if (!ctx || !this.voiceStatus) return;
		const mute = this.inputMuted ? ctx.ui.theme.fg("warning", " · mic muted") : "";
		ctx.ui.setStatus("codex-voice", `${ctx.ui.theme.fg("accent", `voice: ${this.voiceStatus}`)}${mute}`);
	}
}
