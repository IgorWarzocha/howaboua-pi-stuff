import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import { CodexRealtimeConversation } from "./conversation/session.ts";
import { CodexDictationSession } from "./dictation/session.ts";
import { CodexVoiceSessionMessages } from "./session-messages.ts";
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

	async start(ctx: ExtensionContext, config: CodexConversionConfig): Promise<void> {
		const mode: CodexVoiceMode = config.voice.mode === "transcription" ? "dictation" : "realtime";
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
		this.messages.setContext(ctx);
		this.state = { type: "connecting", mode };
		this.renderStatus("connecting…");
		try {
			const auth = await resolveCodexVoiceAuth(ctx);
			if (startGeneration !== this.startGeneration || this.state.type !== "connecting") return;
			if (mode === "dictation") await this.startDictation(auth, config);
			else await this.startConversation(auth, config, realtimePrompt!);
			if (!this.modeIsActive(mode)) return;
			this.announcedMode = mode;
			this.messages.modeStarted(mode);
		} catch (error) {
			this.fail(error instanceof Error ? error : new Error(String(error)));
		}
	}

	async stop(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		const session = this.currentSession();
		this.state = { type: "idle" };
		this.announcedMode = undefined;
		this.context?.ui.setStatus("codex-voice", undefined);
		await session?.close();
		this.messages.voiceStopped(endedMode);
	}

	async finishDictation(options?: { announce?: boolean }): Promise<void> {
		this.startGeneration += 1;
		const session = this.state.type === "dictation"
			? this.state.session
			: this.state.type === "connecting" && this.state.session instanceof CodexDictationSession
				? this.state.session
				: undefined;
		if (!session) { await this.stop(options); return; }
		await session.finish();
		if (this.currentSession() !== session) return;
		const endedMode = options?.announce ? this.announcedMode : undefined;
		this.state = { type: "idle" };
		this.announcedMode = undefined;
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
	): Promise<void> {
		let session!: CodexRealtimeConversation;
		session = new CodexRealtimeConversation({
			onError: (error) => this.failSession(session, error),
			onStatus: (status) => this.renderStatus(status),
			onTurn: (turn) => this.messages.voiceTurn(turn),
		});
		this.state = { type: "connecting", mode: "realtime", session };
		await session.start(auth, config, instructions);
		if (this.currentSession() === session) this.state = { type: "conversation", session };
		else await session.close();
	}

	private async startDictation(
		auth: Awaited<ReturnType<typeof resolveCodexVoiceAuth>>,
		config: CodexConversionConfig,
	): Promise<void> {
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
		this.startGeneration += 1;
		const endedMode = this.announcedMode;
		const session = this.currentSession();
		this.state = { type: "failed", message: error.message };
		this.announcedMode = undefined;
		this.context?.ui.setStatus("codex-voice", undefined);
		this.context?.ui.notify(error.message, "error");
		this.messages.voiceStopped(endedMode);
		void session?.close();
	}

	private renderStatus(status: string): void {
		const ctx = this.context;
		if (ctx) ctx.ui.setStatus("codex-voice", ctx.ui.theme.fg("accent", `voice: ${status}`));
	}
}
