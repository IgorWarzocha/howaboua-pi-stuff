import type {
	ContextEvent,
	ExtensionAPI,
	ExtensionContext,
	InputEvent,
	MessageStartEvent,
} from "@earendil-works/pi-coding-agent";
import { renderRealtimeDelegation, renderRealtimeTranscriptTail } from "./prompts.ts";
import type { RealtimeVoiceTurn } from "./turns.ts";
import {
	CODEX_VOICE_MODE_MESSAGE_TYPE,
	type CodexVoiceMode,
	type CodexVoiceModeMessageDetails,
	type CodexVoiceModeState,
	REALTIME_VOICE_MESSAGE_TYPE,
	type RealtimeVoiceMessageDetails,
} from "./ui.ts";

interface PendingDelegationContext {
	input: string;
	transcriptDelta?: string;
}

interface AcceptedDelegationContext extends PendingDelegationContext {
	acceptedAt: number;
}

interface BoundDelegationContext extends PendingDelegationContext {
	timestamp: number;
}

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
	private backendTurnPending = false;
	private dictationAnnounced = false;
	private pendingDelegations: PendingDelegationContext[] = [];
	private acceptedDelegations: AcceptedDelegationContext[] = [];
	private boundDelegations: BoundDelegationContext[] = [];

	constructor(pi: ExtensionAPI, callbacks: CodexVoiceSessionMessageCallbacks) {
		this.pi = pi;
		this.callbacks = callbacks;
	}

	setContext(ctx: ExtensionContext): void {
		this.context = ctx;
		this.piTurnActive = !ctx.isIdle();
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
		this.backendTurnPending = false;
		this.pendingDelegations = [];
		this.acceptedDelegations = [];
		this.boundDelegations = [];
	}

	conversationInputStopped(): void {
		this.appendMode("realtime", "ended");
	}

	voiceStopped(mode?: CodexVoiceMode): void {
		this.backendTurnPending = false;
		this.piTurnActive = this.context ? !this.context.isIdle() : false;
		if (mode && mode !== "dictation") this.appendMode(mode, "ended");
		this.pendingDelegations = [];
		this.acceptedDelegations = [];
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
		this.pi.sendMessage({
			customType: REALTIME_VOICE_TAIL_CONTEXT_TYPE,
			content: renderRealtimeTranscriptTail(transcriptDelta),
			display: false,
			details: {},
		}, { triggerTurn: false, deliverAs: "nextTurn" });
	}

	acceptDelegatedInput(event: InputEvent): void {
		if (event.source !== "extension") return;
		const pendingIndex = this.pendingDelegations.findIndex(
			(delegation) => delegation.input === event.text,
		);
		if (pendingIndex === -1) return;
		const [delegation] = this.pendingDelegations.splice(pendingIndex, 1);
		if (!delegation) return;
		this.acceptedDelegations.push({ ...delegation, acceptedAt: Date.now() });
	}

	bindDelegatedUserMessage(message: MessageStartEvent["message"]): void {
		if (message.role !== "user") return;
		const input = userMessageText(message.content);
		if (!input) return;
		const acceptedIndex = this.acceptedDelegations.findIndex(
			(delegation) => delegation.input === input
				&& message.timestamp >= delegation.acceptedAt,
		);
		if (acceptedIndex === -1) return;
		const [delegation] = this.acceptedDelegations.splice(acceptedIndex, 1);
		if (!delegation) return;
		this.boundDelegations.push({ ...delegation, timestamp: message.timestamp });
	}

	applyDelegationContext(
		messages: ContextEvent["messages"],
	): ContextEvent["messages"] {
		const contextMessages = messages.filter((message) => !isLegacyVoiceDisplayMessage(message));
		this.boundDelegations = this.boundDelegations.filter((delegation) => contextMessages.some((message) =>
			message.role === "user"
			&& message.timestamp === delegation.timestamp
			&& userMessageText(message.content) === delegation.input
		));
		if (this.boundDelegations.length === 0) return contextMessages;
		return contextMessages.map((message) => {
			if (message.role !== "user") return message;
			const input = userMessageText(message.content);
			const delegation = this.boundDelegations.find(
				(candidate) =>
					candidate.timestamp === message.timestamp &&
					candidate.input === input,
			);
			if (!delegation) return message;
			const nonTextContent = Array.isArray(message.content)
				? message.content.filter((part) => part.type !== "text")
				: [];
			return {
				...message,
				content: [
					{
						type: "text",
						text: renderRealtimeDelegation(
							delegation.input,
							delegation.transcriptDelta,
						),
					},
					...nonTextContent,
				],
			};
		});
	}

	consumeDelegatedTurnStart(): boolean {
		if (!this.backendTurnPending) return false;
		this.backendTurnPending = false;
		return true;
	}

	agentStarted(): void {
		this.piTurnActive = true;
	}

	agentSettled(): void {
		this.piTurnActive = false;
		this.pendingDelegations = [];
		this.acceptedDelegations = [];
	}

	private appendMode(mode: CodexVoiceMode, state: CodexVoiceModeState): void {
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
		this.pendingDelegations.push({
			input: turn.input,
			...(turn.transcriptDelta
				? { transcriptDelta: turn.transcriptDelta }
				: {}),
		});
		if (startsTurn) this.backendTurnPending = true;
		this.piTurnActive = true;
		this.callbacks.onWorking();
		// Keep Pi's user-input pipeline; provider context adds the voice transcript
		// without exposing transport markup in the visible user message.
		this.pi.sendUserMessage(
			turn.input,
			startsTurn ? undefined : { deliverAs: "steer" },
		);
		return true;
	}
}

function userMessageText(content: unknown): string | undefined {
	if (!Array.isArray(content)) return undefined;
	const text = content
		.flatMap((part) =>
			part &&
			typeof part === "object" &&
			"type" in part &&
			part.type === "text" &&
			"text" in part &&
			typeof part.text === "string"
				? [part.text]
				: [],
		)
		.join("\n")
		.trim();
	return text || undefined;
}

function isLegacyVoiceDisplayMessage(message: ContextEvent["messages"][number]): boolean {
	return message.role === "custom"
		&& (message.customType === REALTIME_VOICE_MESSAGE_TYPE || message.customType === CODEX_VOICE_MODE_MESSAGE_TYPE);
}
