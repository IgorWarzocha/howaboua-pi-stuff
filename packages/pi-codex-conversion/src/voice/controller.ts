import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CodexConversionConfig } from "../adapter/activation/config.ts";
import { resolveCodexVoiceAuth } from "./auth.ts";
import { CANCELLED, interruptible } from "./cancellation.ts";
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

	async start(ctx: ExtensionContext, config: CodexConversionConfig, mode: CodexVoiceMode): Promise<void> {
		await this.startMode(ctx, config, mode);
	}

	async startRealtimeWithPeer(ctx: ExtensionContext, config: CodexConversionConfig, peer: CodexRealtimePeer, signal?: AbortSignal): Promise<CodexRealtimeConversation | undefined> {
		return this.startMode(ctx, config, "realtime", peer, signal);
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
		if (this.announcedMode !== "realtime") return;
		this.announcedMode = undefined;
		this.messages.voiceStopped("realtime");
	}

	private async startMode(ctx: ExtensionContext, config: CodexConversionConfig, mode: CodexVoiceMode, peer?: CodexRealtimePeer, signal?: AbortSignal): Promise<CodexRealtimeConversation | undefined> {
		if (signal?.aborted) { await peer?.close(); return; }
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
			onTranscript: (transcript) => this.context?.ui.pasteToEditor(transcript),
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
