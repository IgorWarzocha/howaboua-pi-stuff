import { randomUUID } from "node:crypto";
import { CANCELLED, interruptible } from "../cancellation.ts";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import {
	ApiLiveSpeech,
	TRANSCRIPT_GRACE_MS,
	type ApiLiveLifecycle,
} from "./api-live-speech.ts";
import {
	RealtimeDelegationHandoff,
	type RealtimeHandoffChannel,
	type RealtimeHandoffTarget,
} from "./handoff.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";
import { remoteError, utf8Chunks } from "./wire.ts";

const PREPARATION_TIMEOUT_MS = 45_000;
const CONTEXT_APPEND_CHUNK_BYTES = 500; // At most 500 tokens, even with byte fallback.
const MAX_PENDING_DELEGATIONS = 8;
const MAX_SEEN_EVENTS = 65_536;

interface Delegation {
	id: string;
	after: number;
	at: number;
	timer?: ReturnType<typeof setTimeout>;
	lateInput?: true;
}

function record(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function time(value: unknown): number | undefined {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
		? value
		: undefined;
}

function identifier(value: unknown): string | undefined {
	return typeof value === "string" &&
		value.length &&
		Buffer.byteLength(value) <= 256
		? value
		: undefined;
}

/** Public GPT-Live client delegation: approximate transcript intervals, not provider user turns. */
export class ApiLiveTurns {
	readonly handoff: RealtimeDelegationHandoff;
	readonly playback: RealtimePlayback;
	private readonly speech: ApiLiveSpeech;
	private lastYield = -1;

	private readonly abort = new AbortController();
	private readonly seenEvents = new Set<string>();
	private readonly seenDelegations = new Set<string>();
	private readonly pending = new Map<string, Delegation>();
	private idle = Promise.withResolvers<void>();
	private preparation = Promise.resolve();
	private finishing = false;
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly isActive: () => boolean;
	private readonly onFailure: (error: Error) => void;

	constructor(
		callbacks: CodexConversationCallbacks,
		peer: CodexRealtimePeer,
		isActive: () => boolean,
		onFailure: (error: Error) => void,
		lifecycle: ApiLiveLifecycle = {},
	) {
		this.callbacks = callbacks;
		this.peer = peer;
		this.isActive = isActive;
		this.onFailure = onFailure;
		this.playback = new RealtimePlayback((suppressed) =>
			peer.setSpeakerSuppressed(suppressed),
		);
		this.speech = new ApiLiveSpeech({
			callbacks,
			playback: this.playback,
			lifecycle,
			isActive: () => this.isActive(),
			signal: this.abort.signal,
			onFailure: (error) => this.onFailure(error),
			onUserSpeech: () => {
				for (const delegation of this.pending.values())
					if (!delegation.timer) delegation.lateInput = true;
			},
		});
		this.handoff = new RealtimeDelegationHandoff({
			isActive: () => this.isActive() && !this.abort.signal.aborted,
			onContext: (target, channel, content) =>
				this.sendContext(target, channel, content),
			onSettled: () => {},
		});
	}

	get speakableResponsePending(): boolean {
		return this.speech.speakableResponsePending;
	}

	set speakableResponsePending(pending: boolean) {
		this.speech.speakableResponsePending = pending;
	}

	get hasPendingInput(): boolean {
		return this.speech.hasPendingInput;
	}

	audioActivity(): void {
		if (!this.isActive() || this.abort.signal.aborted) return;
		this.speech.audioActivity();
	}

	receive(value: unknown): void {
		const event = record(value);
		if (!event || this.abort.signal.aborted) return;
		const type = event["type"];
		if (type === "error") {
			this.onFailure(new Error(remoteError(event)));
			return;
		}
		if (!this.isActive() || this.finishing) return;
		if (
			type !== "session.input_transcript.delta" &&
			type !== "session.output_transcript.delta" &&
			type !== "session.delegation.created"
		)
			return;
		const id = identifier(event["event_id"]);
		if (id && this.seenEvents.has(id)) return;
		if (!id || this.seenEvents.size >= MAX_SEEN_EVENTS) {
			this.onFailure(
				new Error("Voice could not track incoming events. Start voice again."),
			);
			return;
		}
		this.seenEvents.add(id);
		if (type === "session.delegation.created") this.receiveDelegation(event);
		else
			this.receiveFragment(
				type === "session.input_transcript.delta" ? "user" : "assistant",
				event,
			);
	}

	private receiveFragment(
		role: "user" | "assistant",
		event: Record<string, unknown>,
	): void {
		const text = event["delta"];
		const start = time(event["start_ms"]);
		const end = time(event["end_ms"]);
		if (
			typeof text !== "string" ||
			Buffer.byteLength(text) > MAX_REALTIME_VOICE_INPUT_BYTES ||
			start === undefined ||
			end === undefined ||
			end < start
		) {
			this.onFailure(
				new Error(
					"Voice received an invalid transcript fragment. Start voice again.",
				),
			);
			return;
		}
		this.speech.receiveFragment(role, text, start, end, this.lastYield);
	}

	private receiveDelegation(event: Record<string, unknown>): void {
		const metadata = record(event["delegation"]);
		if (
			metadata?.["target"] === "responses" ||
			metadata?.["target"] === "decisions"
		)
			return;
		const id = identifier(metadata?.["id"]);
		const at = time(event["offset_ms"]);
		if (
			!id ||
			at === undefined ||
			metadata?.["type"] !== "delegation" ||
			metadata["target"] !== "client"
		) {
			this.onFailure(
				new Error(
					"Voice received an invalid client delegation. Start voice again.",
				),
			);
			return;
		}
		if (this.seenDelegations.has(id)) return;
		this.seenDelegations.add(id);
		const after = this.lastYield;
		this.lastYield = Math.max(after, at);
		if (at <= after || this.pending.size >= MAX_PENDING_DELEGATIONS) {
			this.unsent(
				id,
				at <= after
					? "The request did not have a new speech interval."
					: "Too many voice requests are still being prepared.",
			);
			return;
		}
		const delegation = { id, after, at };
		if (!this.pending.size) this.idle = Promise.withResolvers<void>();
		this.pending.set(id, delegation);
		this.collect(delegation);
	}

	private collect(delegation: Delegation): void {
		delegation.timer = setTimeout(() => {
			delete delegation.timer;
			if (this.discardStaleRequest(delegation)) return;
			const { id, after, at } = delegation;
			const captured = this.speech.captureInterval(after, at);
			if ("reason" in captured) {
				this.settled(id);
				this.unsent(id, captured.reason);
				return;
			}
			const { input, context, markHandled } = captured;
			const turn: RealtimeVoiceTurn = {
				input,
				delegationId: id,
				...(context ? { transcriptDelta: context } : {}),
			};
			this.preparation = this.preparation.then(() =>
				this.prepare(delegation, turn, markHandled),
			);
			void this.preparation.catch((error: unknown) => {
				if (!this.abort.signal.aborted) this.onFailure(asError(error));
			});
		}, TRANSCRIPT_GRACE_MS);
	}

	private async prepare(
		delegation: Delegation,
		turn: RealtimeVoiceTurn,
		markHandled: () => void,
	): Promise<void> {
		const { id, at } = delegation;
		if (this.abort.signal.aborted || (!this.isActive() && !this.finishing))
			return;
		if (this.discardStaleRequest(delegation)) return;
		const signal = AbortSignal.any([
			this.abort.signal,
			AbortSignal.timeout(PREPARATION_TIMEOUT_MS),
		]);
		let prepared: Awaited<
			ReturnType<NonNullable<CodexConversationCallbacks["rewriteDelegation"]>>
		>;
		try {
			if (!this.callbacks.rewriteDelegation)
				throw new Error("Voice task preparation is unavailable.");
			const result = await interruptible(
				this.callbacks.rewriteDelegation(turn, signal),
				signal,
			);
			if (result === CANCELLED) signal.throwIfAborted();
			if (result === CANCELLED) return;
			if (!result.input && !result.endCall)
				throw new Error("Voice task preparation returned no request.");
			if (Buffer.byteLength(result.input) > MAX_REALTIME_VOICE_INPUT_BYTES)
				throw new Error("The prepared request was too long to send intact.");
			prepared = result;
		} catch (error) {
			if (!this.abort.signal.aborted) {
				if (this.discardStaleRequest(delegation)) return;
				this.settled(id);
				this.unsent(
					id,
					signal.aborted
						? "Voice task preparation timed out."
						: asError(error).message,
				);
			}
			return;
		}
		if (this.abort.signal.aborted || (!this.isActive() && !this.finishing))
			return;
		if (this.discardStaleRequest(delegation)) return;
		this.settled(id);
		this.speech.finishInput(at);
		const endCall =
			prepared.endCall && this.isActive() && !this.speech.hasInputAtOrAfter(at);
		if (endCall)
			this.callbacks.onEndCall?.(false, prepared.input ? id : undefined);
		// Submission is not a delivery receipt. Don't retry if the callback fails.
		if (prepared.input) {
			this.callbacks.onTurn({ input: prepared.input, delegationId: id });
			markHandled();
		} else if (endCall) {
			this.sendContext(
				{ type: "delegation", id },
				"speakable",
				"The user wants to end the call. Say a brief farewell.",
			);
		}
	}

	private settled(id: string): void {
		this.pending.delete(id);
		if (!this.pending.size) this.idle.resolve();
	}

	private discardStaleRequest(delegation: Delegation): boolean {
		// Later speech can correct this request. Before capture, in-interval
		// fragments can still be included; after capture the snapshot is fixed.
		if (!delegation.lateInput && !this.speech.hasInputAtOrAfter(delegation.at))
			return false;
		this.settled(delegation.id);
		this.unsent(
			delegation.id,
			"More user speech arrived before the request could be sent.",
		);
		return true;
	}

	private unsent(id: string, reason: string): void {
		const message = `${reason} This request was not sent to Pi. If you still want to proceed, please restate the complete request.`;
		this.callbacks.onDelegationError?.(new Error(message));
		this.sendContext(
			{ type: "delegation", id },
			"speakable",
			"Tell the user this request was not sent. If they still want to proceed, ask them to restate the complete request. Do not retry it automatically.",
		);
	}

	sendContext(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
	): void {
		this.append(
			channel === "speakable"
				? "session.commentary.append"
				: "session.thinking.append",
			target.type === "delegation" && this.seenDelegations.has(target.id)
				? target.id
				: null,
			content,
		);
	}

	sendInstructions(content: string): void {
		this.append("session.instructions.append", null, content);
	}

	private append(
		type:
			| "session.commentary.append"
			| "session.thinking.append"
			| "session.instructions.append",
		delegationId: string | null,
		content: string,
	): void {
		if (!this.isActive() || this.abort.signal.aborted || !content.trim())
			return;
		try {
			for (const chunk of utf8Chunks(content, CONTEXT_APPEND_CHUNK_BYTES))
				this.peer.sendData({
					type,
					event_id: randomUUID(),
					delegation_id: delegationId,
					content: chunk,
				});
			if (type !== "session.thinking.append") this.speech.expectOutput();
		} catch (error) {
			this.onFailure(asError(error));
		}
	}

	async waitForDelegations(signal: AbortSignal): Promise<void> {
		signal.throwIfAborted();
		while (this.pending.size) {
			if ((await interruptible(this.idle.promise, signal)) === CANCELLED)
				signal.throwIfAborted();
		}
	}

	async finishDelegations(): Promise<void> {
		this.finishing = true;
		if (this.pending.size) await this.idle.promise;
	}

	drainConversation(): void {
		if (this.abort.signal.aborted) return;
		this.abort.abort();
		const unsent = this.pending.size;
		for (const { timer } of this.pending.values()) clearTimeout(timer);
		this.pending.clear();
		this.idle.resolve();
		const tail = this.speech.drain();
		this.seenEvents.clear();
		this.seenDelegations.clear();
		for (let index = 0; index < unsent; index++)
			this.callbacks.onDelegationError?.(
				new Error(
					"Voice stopped before a request was sent to Pi. Please repeat it.",
				),
			);
		if (tail.trim()) this.callbacks.onTranscriptTail(tail);
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
