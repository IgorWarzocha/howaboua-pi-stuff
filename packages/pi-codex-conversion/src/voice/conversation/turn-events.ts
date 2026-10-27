import { randomUUID } from "node:crypto";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import { RealtimeVoiceTurnTracker } from "../turns.ts";
import {
	RealtimeDelegationHandoff,
	type RealtimeHandoffChannel,
	type RealtimeHandoffTarget,
} from "./handoff.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";
import {
	boundedAssistantTranscript,
	boundedTranscript,
	realtimeEventDetails,
	realtimeEventIdentity,
	remoteError,
	transcriptItemText,
	utf8Chunks,
} from "./wire.ts";

const CONTEXT_APPEND_CHUNK_BYTES = 500;

/** Owns transcript/delegation turns, spoken interruption and context framing for one peer. */
export class ConversationTurns {
	private readonly turnTracker = new RealtimeVoiceTurnTracker();
	readonly handoff: RealtimeDelegationHandoff;
	readonly playback: RealtimePlayback;
	speakableResponsePending = false;
	private readonly callId = randomUUID();
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly isActive: () => boolean;
	private readonly onFailure: (error: Error) => void;
	constructor(
		callbacks: CodexConversationCallbacks,
		peer: CodexRealtimePeer,
		isActive: () => boolean,
		onFailure: (error: Error) => void,
	) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.isActive = isActive;
		this.onFailure = onFailure;
		this.playback = new RealtimePlayback((suppressed) =>
			this.peer.setSpeakerSuppressed(suppressed),
		);
		this.handoff = new RealtimeDelegationHandoff({
			isActive: () => this.isActive(),
			onContext: (target, channel, content) =>
				this.sendContext(target, channel, content),
			onSettled: (id) => this.turnTracker.delegationSettled(id),
		});
	}
	get hasPendingInput(): boolean {
		return this.turnTracker.hasPendingInput;
	}
	receive(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const event = value as Record<string, unknown>;
		if (event["type"] === "error") {
			this.onFailure(new Error(remoteError(event)));
			return;
		}
		if (
			event["type"] === "turn.created" ||
			event["type"] === "delegation.context.appended" ||
			event["type"] === "session.context.appended"
		) {
			this.callbacks.onEvent?.(
				realtimeEventDetails(this.callId, event, undefined, true),
			);
			return;
		}
		if (event["type"] === "input_transcript.added") {
			const input = boundedTranscript(transcriptItemText(event["item"]));
			if (input === "oversized") {
				this.onFailure(new Error("Codex voice transcript was oversized"));
				return;
			}
			if (input) {
				this.playback.inputStarted(this.speakableResponsePending);
				this.callbacks.onEvent?.(
					realtimeEventDetails(this.callId, event, input, true),
				);
				this.turnTracker.inputAdded(input);
			}
			return;
		}
		if (event["type"] === "output_transcript.added") {
			const output = boundedAssistantTranscript(
				transcriptItemText(event["item"]),
			);
			if (output) {
				this.playback.outputAdded();
				this.turnTracker.outputAdded(output);
			}
			this.callbacks.onStatus("speaking");
			return;
		}
		if (event["type"] === "turn.done") {
			this.callbacks.onEvent?.(
				realtimeEventDetails(this.callId, event, undefined, true),
			);
			this.handleCompletedTurn(event["turn"]);
			return;
		}
		if (event["type"] !== "delegation.created" || !this.isActive()) return;
		const item = event["item"];
		if (!item || typeof item !== "object") return;
		const record = item as Record<string, unknown>;
		const delegationId = realtimeEventIdentity(record);
		if (
			record["type"] !== "delegation" ||
			record["target"] !== "client" ||
			!delegationId ||
			!Array.isArray(record["content"])
		)
			return;
		const input = record["content"]
			.flatMap((part) =>
				part &&
				typeof part === "object" &&
				(part as Record<string, unknown>)["type"] === "input_text" &&
				typeof (part as Record<string, unknown>)["text"] === "string"
					? [(part as Record<string, unknown>)["text"] as string]
					: [],
			)
			.join("")
			.trim();
		if (!input || Buffer.byteLength(input) > MAX_REALTIME_VOICE_INPUT_BYTES) {
			this.onFailure(
				new Error("Codex voice delegation was empty or oversized"),
			);
			return;
		}
		const delegated = this.turnTracker.delegated(input, delegationId);
		this.callbacks.onEvent?.(
			realtimeEventDetails(this.callId, event, input, Boolean(delegated)),
		);
		if (!delegated) return;
		if (delegated.displayInput) this.callbacks.onUserTranscript(input);
		this.callbacks.onTurn(delegated.turn);
	}

	private handleCompletedTurn(turn: unknown): void {
		if (!turn || typeof turn !== "object") return;
		const record = turn as Record<string, unknown>;
		if (record["role"] === "user") {
			const input = boundedTranscript(record["transcript"]);
			if (input === "oversized") {
				this.onFailure(new Error("Codex voice transcript was oversized"));
				return;
			}
			this.playback.inputFinished(
				this.speakableResponsePending,
				Boolean(input),
			);
			if (input && this.turnTracker.userFinished(input))
				this.callbacks.onUserTranscript(input);
			this.callbacks.onStatus("responding");
			return;
		}
		if (record["role"] !== "assistant") return;
		this.playback.outputFinished();
		const completed = this.turnTracker.assistantFinished(
			boundedAssistantTranscript(record["transcript"]),
		);
		this.speakableResponsePending = false;
		this.callbacks.onStatus("listening");
		if (completed) this.callbacks.onTurn(completed);
	}

	sendContext(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
	): void {
		try {
			if (channel === "speakable") {
				this.speakableResponsePending = true;
				this.callbacks.onStatus("speaking");
			}
			for (const text of utf8Chunks(content, CONTEXT_APPEND_CHUNK_BYTES)) {
				this.peer.sendData(
					target.type === "delegation"
						? {
								type: "delegation.context.append",
								delegation_item_id: target.id,
								channel,
								content: [{ type: "input_text", text }],
							}
						: {
								type: "session.context.append",
								channel,
								content: [{ type: "input_text", text }],
							},
				);
			}
		} catch (error) {
			this.onFailure(error instanceof Error ? error : new Error(String(error)));
		}
	}

	drainConversation(): void {
		for (const turn of this.turnTracker.drainConversationTurns())
			this.callbacks.onTurn(turn);
		const transcriptTail = this.turnTracker.takeTranscriptTail();
		if (transcriptTail) this.callbacks.onTranscriptTail(transcriptTail);
		this.turnTracker.reset();
	}
}
