import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { renderRealtimeTranscriptTail } from "./prompts.ts";
import type { RealtimeVoiceTurn } from "./turns.ts";
import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	type CodexVoiceMode,
	type CodexVoiceModeMessageDetails,
	type CodexVoiceModeState,
	codexVoiceModeMessage,
	REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
	type RealtimeUserTranscriptMessageDetails,
	type RealtimeVoiceMessageDetails,
	realtimeVoiceMessage,
	VOICE_CONTEXT_MESSAGE_TYPE,
} from "./ui.ts";

const REALTIME_VOICE_TAIL_CONTEXT_TYPE = "codex-realtime-voice-tail";

export interface CodexVoiceSessionMessageCallbacks {
	canDelegate(): boolean;
	onDelegation(id: string): void;
	onWorking(): void;
}

export class CodexVoiceSessionMessages {
	private readonly pi: ExtensionAPI;
	private readonly callbacks: CodexVoiceSessionMessageCallbacks;
	private context: ExtensionContext | undefined;
	private piTurnActive = false;
	private dictationAnnounced = false;

	constructor(pi: ExtensionAPI, callbacks: CodexVoiceSessionMessageCallbacks) {
		this.pi = pi;
		this.callbacks = callbacks;
	}

	setContext(ctx: ExtensionContext): void {
		this.context = ctx;
		this.piTurnActive = !ctx.isIdle();
	}

	contextSummary(summary: string): void {
		this.pi.appendEntry(VOICE_CONTEXT_MESSAGE_TYPE, { summary });
	}

	userTranscript(transcript: string): void {
		this.pi.appendEntry<RealtimeUserTranscriptMessageDetails>(
			REALTIME_USER_TRANSCRIPT_MESSAGE_TYPE,
			{ transcript },
		);
	}

	modeStarted(mode: CodexVoiceMode): void {
		if (mode === "dictation") {
			if (this.dictationAnnounced) return;
			this.dictationAnnounced = true;
		}
		this.appendMode(mode, "started");
	}

	resetContextAnnouncements(): void {
		this.dictationAnnounced = false;
	}

	resetSessionContext(): void {
		this.context = undefined;
		this.piTurnActive = false;
	}

	conversationInputStopped(): void {
		this.appendMode("realtime", "ended");
	}

	voiceStopped(mode?: CodexVoiceMode): void {
		this.piTurnActive = this.context ? !this.context.isIdle() : false;
		if (mode && mode !== "dictation") this.appendMode(mode, "ended");
		this.context = undefined;
	}

	voiceTurn(turn: RealtimeVoiceTurn): void {
		if (!turn.delegationId) {
			this.pi.appendEntry<RealtimeVoiceMessageDetails>(
				REALTIME_VOICE_MESSAGE_TYPE,
				{
					input: turn.input,
					route: "conversation",
				},
			);
			return;
		}
		const ctx = this.context;
		if (!ctx) return;
		this.deliverDelegation(turn, !this.piTurnActive && ctx.isIdle());
	}

	retainTranscriptTail(transcriptDelta: string): void {
		const piTurnActive =
			this.piTurnActive || (this.context ? !this.context.isIdle() : false);
		this.pi.sendMessage(
			{
				customType: REALTIME_VOICE_TAIL_CONTEXT_TYPE,
				content: renderRealtimeTranscriptTail(transcriptDelta),
				display: false,
				details: {},
			},
			{
				triggerTurn: false,
				deliverAs: piTurnActive ? "nextTurn" : "steer",
			},
		);
	}

	filterContext(messages: ContextEvent["messages"]): ContextEvent["messages"] {
		return messages.filter(
			(message) => !isContextExcludedVoiceMessage(message),
		);
	}

	agentStarted(): void {
		this.piTurnActive = true;
	}

	agentSettled(): void {
		this.piTurnActive = false;
	}

	private appendMode(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
		if (mode === "realtime") {
			this.pi.sendMessage(codexVoiceModeMessage(mode, state), {
				triggerTurn: false,
				deliverAs: "steer",
			});
			return;
		}
		this.pi.appendEntry<CodexVoiceModeMessageDetails>(
			CODEX_VOICE_MODE_MESSAGE_TYPE,
			{ mode, state },
		);
	}

	private deliverDelegation(
		turn: RealtimeVoiceTurn,
		startsTurn: boolean,
	): boolean {
		if (!turn.delegationId || !this.callbacks.canDelegate()) return false;
		this.callbacks.onDelegation(turn.delegationId);
		this.piTurnActive = true;
		this.callbacks.onWorking();
		this.pi.sendMessage(
			realtimeVoiceMessage(turn.input, "delegation", turn.transcriptDelta),
			startsTurn
				? { triggerTurn: true }
				: { triggerTurn: true, deliverAs: "steer" },
		);
		return true;
	}
}

function isContextExcludedVoiceMessage(
	message: ContextEvent["messages"][number],
): boolean {
	if (message.role !== "custom") return false;
	if (message.customType === REALTIME_VOICE_MESSAGE_TYPE) return true;
	return (
		message.customType === CODEX_VOICE_MODE_MESSAGE_TYPE &&
		(typeof message.content !== "string" ||
			!message.content.startsWith('<realtime_voice_session state="'))
	);
}
