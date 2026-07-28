import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import type { CodexRealtimeConversation } from "./conversation/session.ts";
import type { CodexRealtimePeer } from "./conversation/peer.ts";
import type { CodexDictationSession } from "./dictation/session.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
import { formatVoiceAudioError } from "./setup.ts";
import { getProjectCodexVoiceSystemPromptPath, loadCodexVoiceSystemPrompt } from "./system-prompt.ts";
import type { CodexVoiceMode } from "./ui.ts";

type VoiceSession = CodexRealtimeConversation | CodexDictationSession;
type VoiceState =
	| { type: "idle" }
	| { type: "connecting"; mode: CodexVoiceMode; session?: VoiceSession }
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

	constructor(pi: ExtensionAPI) {
		this.messages = new CodexVoiceSessionMessages(pi, {
			canDelegate: () => this.state.type === "conversation",
			isVoiceActive: () => this.active,
			onDelegation: (id) => { if (this.state.type === "conversation") this.state.session.activateDelegation(id); },
			onWorking: () => this.renderStatus("working"),
		});
	}

	get status(): string { return this.state.type; }
	get active(): boolean { return this.state.type !== "idle" && this.state.type !== "failed"; }
	get activeMode(): CodexVoiceMode | undefined { return this.announcedMode; }
	resetContextAnnouncements(): void { this.messages.resetContextAnnouncements(); }
	announceDictation(ctx: ExtensionContext): void {
		this.messages.setContext(ctx);
		this.messages.modeStarted("dictation");
	}

	async start(ctx: ExtensionContext, config: CodexConversionConfig): Promise<void> {
		const mode: CodexVoiceMode = config.voice.mode === "transcription" ? "dictation" : "realtime";
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeer(ctx: ExtensionContext, config: CodexConversionConfig, peer: CodexRealtimePeer): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", peer);
	}

	async stopConversation(session: CodexRealtimeConversation, options?: { announce?: boolean }): Promise<void> {
		if (this.currentSession() === session) await this.stop(options);
	}

	private async startMode(ctx: ExtensionContext, config: CodexConversionConfig, mode: CodexVoiceMode, peer?: CodexRealtimePeer): Promise<CodexRealtimeConversation | undefined> {
		let realtimePrompt: string | undefined;
		try {
			realtimePrompt = mode === "realtime"
				? loadCodexVoiceSystemPrompt(undefined, ctx.isProjectTrusted() ? getProjectCodexVoiceSystemPromptPath(ctx.cwd) : undefined)
				: undefined;
		} catch (error) {
			ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			return;
		}
		if (this.state.type === "dictation") await this.finishDictation({ announce: true });
		else await this.stop({ announce: true });
		const startGeneration = ++this.startGeneration;
		this.context = ctx;
		this.config = config;
		this.messages.setContext(ctx);
		this.state = { type: "connecting", mode };
		this.renderStatus("connecting…");
		try {
			const auth = await resolveCodexVoiceAuth(ctx);
			if (startGeneration !== this.startGeneration || this.state.type !== "connecting") return;
			if (mode === "dictation") await this.startDictation(auth, config);
			else await this.startConversation(auth, config, realtimePrompt!, peer);
			if (!this.modeIsActive(mode)) return;
			this.announcedMode = mode;
			this.messages.modeStarted(mode);
			return mode === "realtime" ? this.currentSession() as CodexRealtimeConversation : undefined;
		} catch (error) {
			if (startGeneration !== this.startGeneration) return;
			this.fail(error instanceof Error ? error : new Error(String(error)));
			return undefined;
		}
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		const session = this.currentSession();
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.context?.ui.setStatus("codex-voice", undefined);
		await session?.close();
		this.messages.voiceStopped(endedMode);
	}

	async finishDictation(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const session = this.state.type === "dictation"
			? this.state.session
			: this.state.type === "connecting" && this.state.mode === "dictation"
				? this.state.session as CodexDictationSession | undefined
				: undefined;
		if (!session) { await this.stop(options); return; }
		await session.finish();
		if (this.currentSession() !== session) return;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.config = undefined;
		this.context?.ui.setStatus("codex-voice", undefined);
		this.messages.voiceStopped(endedMode);
	}

	consumeDelegatedTurnStart(): boolean {
		return this.messages.consumeDelegatedTurnStart();
	}

	agentStarted(): void {
		this.messages.agentStarted();
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
	): Promise<void> {
		const connecting = this.state;
		if (connecting.type !== "connecting" || connecting.mode !== "realtime") return;
		const { CodexRealtimeConversation } = await import("./conversation/session.ts");
		if (this.state !== connecting) return;
		const realtimePeer = peer ?? new (await import("./conversation/native-peer.ts")).NativeCodexRealtimePeer();
		if (this.state !== connecting) { await realtimePeer.close(); return; }
		let session!: CodexRealtimeConversation;
		session = new CodexRealtimeConversation({
			onError: (error) => this.failSession(session, error),
			onStatus: (status) => this.renderStatus(status),
			onTurn: (turn) => this.messages.voiceTurn(turn),
		}, realtimePeer);
		this.state = { type: "connecting", mode: "realtime", session };
		await session.start(auth, config, instructions);
		if (this.currentSession() === session) this.state = { type: "conversation", session };
		else await session.close();
	}

	private async startDictation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: CodexConversionConfig,
	): Promise<void> {
		const connecting = this.state;
		if (connecting.type !== "connecting" || connecting.mode !== "dictation") return;
		const { CodexDictationSession } = await import("./dictation/session.ts");
		if (this.state !== connecting) return;
		let session!: CodexDictationSession;
		session = new CodexDictationSession({
			onError: (error) => this.failSession(session, error),
			onStatus: (status) => this.renderStatus(status),
			onTranscript: (transcript) => this.context?.ui.pasteToEditor(transcript),
		});
		this.state = { type: "connecting", mode: "dictation", session };
		await session.start(auth, config);
		if (this.currentSession() === session) this.state = { type: "dictation", session };
		else await session.close();
	}

	private currentSession(): VoiceSession | undefined {
		if (this.state.type === "conversation" || this.state.type === "dictation") return this.state.session;
		return this.state.type === "connecting" ? this.state.session : undefined;
	}

	private modeIsActive(mode: CodexVoiceMode): boolean {
		return mode === "dictation" ? this.state.type === "dictation" : this.state.type === "conversation";
	}

	private failSession(session: VoiceSession, error: Error): void {
		if (this.currentSession() === session) this.fail(error);
	}

	private fail(error: Error): void {
		if (this.state.type === "idle" || this.state.type === "failed") return;
		const mode = this.state.type === "connecting"
			? this.state.mode
			: this.state.type === "dictation" ? "dictation" : "realtime";
		const message = this.config ? formatVoiceAudioError(error, mode, this.config) : error.message;
		this.startGeneration += 1;
		const endedMode = this.announcedMode;
		const session = this.currentSession();
		this.state = { type: "failed", message };
		this.announcedMode = undefined;
		this.config = undefined;
		this.context?.ui.setStatus("codex-voice", undefined);
		this.context?.ui.notify(message, "error");
		this.messages.voiceStopped(endedMode);
		void session?.close();
	}

	private renderStatus(status: string): void {
		const ctx = this.context;
		if (ctx) ctx.ui.setStatus("codex-voice", ctx.ui.theme.fg("accent", `voice: ${status}`));
	}
}
