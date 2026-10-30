import { CANCELLED, interruptible } from "../cancellation.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import { RealtimeVoiceTurnTracker } from "../turns.ts";
import {
	RealtimeDelegationHandoff,
	type RealtimeHandoffChannel,
	type RealtimeHandoffTarget,
} from "./handoff.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";
import { remoteError, transcriptItemText, utf8Chunks } from "./wire.ts";

const CONTEXT_APPEND_CHUNK_BYTES = 500;

/** Owns transcript/delegation turns, spoken interruption and context framing for one peer. */
export class ConversationTurns {
	private readonly delegationAbort = new AbortController();
	private finishing = false;
	private completedOutputs = 0;
	private inputGeneration = 0;
	private delegationTail: Promise<void> = Promise.resolve();
	private readonly pendingDelegations = new Set<RealtimeVoiceTurn>();
	private readonly turnTracker = new RealtimeVoiceTurnTracker(true);
	readonly handoff: RealtimeDelegationHandoff;
	readonly playback: RealtimePlayback;
	speakableResponsePending = false;
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
	receive(value: unknown): void {
		if (!value || typeof value !== "object") return;
		const event = value as Record<string, unknown>;
		if (event["type"] === "error") {
			this.onFailure(new Error(remoteError(event)));
			return;
		}
		if (event["type"] === "turn.created") {
			const turn = event["turn"];
			if (
				turn &&
				typeof turn === "object" &&
				"role" in turn &&
				turn.role === "user"
			) {
				this.inputGeneration++;
				this.turnTracker.inputStarted();
			}
		}

		if (event["type"] === "input_transcript.added") {
			const input = transcriptText(transcriptItemText(event["item"]));
			if (input) {
				this.playback.inputStarted(this.speakableResponsePending);
				this.turnTracker.inputAdded(input);
			}
			return;
		}
		if (event["type"] === "output_transcript.added") {
			const output = transcriptText(transcriptItemText(event["item"]));
			if (output) {
				this.playback.outputAdded();
				this.turnTracker.outputAdded(output);
				this.speakableResponsePending = true;
			}
			this.callbacks.onStatus("speaking");
			return;
		}
		if (event["type"] === "turn.done") {
			this.handleCompletedTurn(event["turn"]);
			return;
		}
		if (event["type"] !== "delegation.created" || !this.isActive()) return;
		const item = event["item"];
		if (!item || typeof item !== "object") return;
		const record = item as Record<string, unknown>;
		if (
			record["type"] !== "delegation" ||
			record["target"] !== "client" ||
			typeof record["id"] !== "string" ||
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
		if (!input) {
			this.onFailure(new Error("Codex voice delegation was empty"));
			return;
		}
		const delegated = this.turnTracker.delegated(input, record["id"]);
		if (!delegated) return;
		if (delegated.displayInput) this.callbacks.onUserTranscript(input);
		this.enqueueDelegation(delegated.turn);
	}

	private enqueueDelegation(turn: RealtimeVoiceTurn): void {
		this.pendingDelegations.add(turn);
		const outputsAtDelegation = this.completedOutputs;
		const inputAtDelegation = this.inputGeneration;
		this.delegationTail = this.delegationTail
			.then(async () => {
				const signal = this.delegationAbort.signal;
				if (signal.aborted || (!this.isActive() && !this.finishing)) return;
				try {
					if (!this.callbacks.rewriteDelegation)
						throw new Error(
							"Voice task preparation is unavailable; restart voice",
						);
					const prepared = await this.callbacks.rewriteDelegation(turn, signal);
					const { input } = prepared;
					if (
						prepared.endCall &&
						this.isActive() &&
						this.inputGeneration === inputAtDelegation
					)
						this.callbacks.onEndCall?.(
							this.completedOutputs > outputsAtDelegation,
							input ? turn.delegationId : undefined,
						);
					if (!input && turn.delegationId)
						this.turnTracker.delegationSettled(turn.delegationId);
					if (!signal.aborted && (this.isActive() || this.finishing) && input) {
						const { transcriptDelta: _transcriptDelta, ...delegation } = turn;
						this.callbacks.onTurn({ ...delegation, input });
					}
				} catch (error) {
					if (signal.aborted || (!this.isActive() && !this.finishing)) return;
					const failure =
						error instanceof Error ? error : new Error(String(error));
					this.sendContext(
						{ type: "session" },
						"speakable",
						`The voice request could not be prepared and was not sent to Pi. Tell the user explicitly that it failed and they can try again. ${failure.message}`,
					);
					this.callbacks.onDelegationError?.(failure);
					if (turn.delegationId)
						this.turnTracker.delegationSettled(turn.delegationId);
				} finally {
					this.pendingDelegations.delete(turn);
				}
			})
			.catch((error: unknown) => {
				if (!this.delegationAbort.signal.aborted)
					this.callbacks.onDelegationError?.(
						error instanceof Error ? error : new Error(String(error)),
					);
			});
	}

	async finishDelegations(): Promise<void> {
		this.finishing = true;
		await this.delegationTail;
	}

	async waitForDelegations(signal: AbortSignal): Promise<void> {
		let pending: Promise<void>;
		do {
			pending = this.delegationTail;
			if ((await interruptible(pending, signal)) === CANCELLED)
				signal.throwIfAborted();
		} while (pending !== this.delegationTail);
	}

	private handleCompletedTurn(turn: unknown): void {
		if (!turn || typeof turn !== "object") return;
		const record = turn as Record<string, unknown>;
		if (record["role"] === "user") {
			const input = transcriptText(record["transcript"]);
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
		this.completedOutputs++;
		this.playback.outputFinished();
		const completed = this.turnTracker.assistantFinished(
			transcriptText(record["transcript"]),
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
		this.delegationAbort.abort();
		for (const turn of this.pendingDelegations) {
			this.callbacks.onDelegationError?.(
				new Error(
					`Voice stopped before this request was sent to Pi: ${turn.input}. Please repeat the request when voice is available.`,
				),
			);
		}
		this.pendingDelegations.clear();
		for (const turn of this.turnTracker.drainConversationTurns())
			this.callbacks.onTurn(turn);
		const transcriptTail = this.turnTracker.takeTranscriptTail();
		if (transcriptTail) this.callbacks.onTranscriptTail(transcriptTail);
		this.turnTracker.reset();
	}
}

function transcriptText(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value : undefined;
}
