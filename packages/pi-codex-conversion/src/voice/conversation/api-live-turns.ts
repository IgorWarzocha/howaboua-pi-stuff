import { randomUUID } from "node:crypto";
import { CANCELLED, interruptible } from "../cancellation.ts";
import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import type { RealtimeVoiceTurn } from "../turns.ts";
import {
	RealtimeDelegationHandoff,
	type RealtimeHandoffChannel,
	type RealtimeHandoffTarget,
} from "./handoff.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";
import { remoteError, utf8Chunks } from "./wire.ts";

const TRANSCRIPT_GRACE_MS = 800;
const OUTPUT_QUIET_MS = 500;
const OUTPUT_START_TIMEOUT_MS = 10_000;
const PREPARATION_TIMEOUT_MS = 45_000;
const CONTEXT_APPEND_CHUNK_BYTES = 500; // At most 500 tokens, even with byte fallback.
const MAX_PENDING_DELEGATIONS = 8;
const MAX_SEEN_EVENTS = 65_536;
const MAX_BUFFER_BYTES = 16 * MAX_REALTIME_VOICE_INPUT_BYTES;

interface ApiLiveLifecycle {
	onInputStarted?(): void;
	onInputChanged?(): void;
	onOutputFinished?(): void;
	onOutputChanged?(): void;
}

type Role = "user" | "assistant";
interface Fragment {
	role: Role;
	text: string;
	start: number;
	end: number;
	handled?: true;
}

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

function render(fragments: readonly Fragment[]): string {
	const lines: Array<{ role: Role; text: string }> = [];
	for (const { role, text } of fragments) {
		const previous = lines.at(-1);
		if (previous?.role === role) previous.text += text;
		else lines.push({ role, text });
	}
	return lines.map(({ role, text }) => `${role}: ${text}`).join("\n");
}

/** Public GPT-Live client delegation: approximate transcript intervals, not provider user turns. */
export class ApiLiveTurns {
	readonly handoff: RealtimeDelegationHandoff;
	readonly playback: RealtimePlayback;
	speakableResponsePending = false;

	private readonly abort = new AbortController();
	private readonly seenEvents = new Set<string>();
	private readonly seenDelegations = new Set<string>();
	private readonly pending = new Map<string, Delegation>();
	private idle = Promise.withResolvers<void>();
	private preparation = Promise.resolve();
	private finishing = false;
	private readonly fragments: Fragment[] = [];
	private bufferBytes = 0;
	private lastYield = -1;
	private latestInputStart = -1;
	private inputCaption: Fragment[] = [];
	private outputCaption = "";
	private inputTimer: ReturnType<typeof setTimeout> | undefined;
	private outputTimer: ReturnType<typeof setTimeout> | undefined;
	private observingOutput = false;
	private heardOutput = false;
	private readonly callbacks: CodexConversationCallbacks;
	private readonly peer: CodexRealtimePeer;
	private readonly isActive: () => boolean;
	private readonly onFailure: (error: Error) => void;
	private readonly lifecycle: ApiLiveLifecycle;

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
		this.lifecycle = lifecycle;
		this.playback = new RealtimePlayback((suppressed) =>
			peer.setSpeakerSuppressed(suppressed),
		);
		this.handoff = new RealtimeDelegationHandoff({
			isActive: () => this.isActive() && !this.abort.signal.aborted,
			onContext: (target, channel, content) =>
				this.sendContext(target, channel, content),
			onSettled: () => {},
		});
	}

	get hasPendingInput(): boolean {
		return this.inputTimer !== undefined;
	}

	audioActivity(): void {
		if (!this.isActive() || this.abort.signal.aborted) return;
		this.playback.audioActivity();
		this.heardOutput = true;
		this.observeOutput();
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

	private receiveFragment(role: Role, event: Record<string, unknown>): void {
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
		if (!text) return;
		const fragment: Fragment = { role, text, start, end };
		this.fragments.push(fragment);
		this.bufferBytes += Buffer.byteLength(text) + 32;
		if (role === "user") this.inputFragment(fragment);
		else {
			this.outputCaption += text;
			if (text.trim()) this.observeOutput();
		}
		this.boundTranscript();
	}

	private inputFragment(fragment: Fragment): void {
		const { text, start } = fragment;
		if (text.trim()) {
			const newSpeech =
				start >= Math.max(this.lastYield, this.latestInputStart);
			this.latestInputStart = Math.max(this.latestInputStart, start);
			if (newSpeech) this.lifecycle.onInputStarted?.();
			for (const delegation of this.pending.values())
				if (!delegation.timer) delegation.lateInput = true;
		}
		const wasPending = this.hasPendingInput;
		this.inputCaption.push(fragment);
		clearTimeout(this.inputTimer);
		this.inputTimer = setTimeout(() => this.finishInput(), TRANSCRIPT_GRACE_MS);
		if (!wasPending) this.lifecycle.onInputChanged?.();
	}

	private finishInput(at = Infinity): void {
		let caption = "";
		this.inputCaption = this.inputCaption.filter(({ text, start }) => {
			if (start >= at) return true;
			caption += text;
			return false;
		});
		if (!this.inputCaption.length && this.hasPendingInput) {
			clearTimeout(this.inputTimer);
			this.inputTimer = undefined;
			this.lifecycle.onInputChanged?.();
		}
		if (caption.trim()) this.callbacks.onUserTranscript(caption);
	}

	// On full-duplex Live, captions don't drive speaker suppression. A delayed
	// transcript is not an audio interruption signal.
	private observeOutput(): void {
		if (!this.observingOutput) {
			this.observingOutput = true;
			this.speakableResponsePending = true;
			this.playback.outputAdded();
			this.callbacks.onStatus("speaking");
			this.lifecycle.onOutputChanged?.();
		}
		this.armOutputTimer(OUTPUT_QUIET_MS);
	}

	private armOutputTimer(delay: number): void {
		clearTimeout(this.outputTimer);
		this.outputTimer = setTimeout(() => this.finishOutput(), delay);
	}

	private finishOutput(): void {
		clearTimeout(this.outputTimer);
		this.outputTimer = undefined;
		const outputObserved = this.heardOutput;
		this.observingOutput = false;
		this.heardOutput = false;
		this.speakableResponsePending = false;
		this.playback.outputFinished();
		const caption = this.outputCaption;
		this.outputCaption = "";
		if (caption.trim()) this.callbacks.onTurn({ input: caption });
		if (outputObserved && this.isActive()) this.lifecycle.onOutputFinished?.();
		this.lifecycle.onOutputChanged?.();
		if (this.isActive() && !this.abort.signal.aborted)
			this.callbacks.onStatus("listening");
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
			const window = this.fragments.filter(
				({ start, end }) => start < at && (start >= after || end > after),
			);
			// The timestamps are approximate. Assign each user fragment whole
			// to the interval where it starts; its end is not a word boundary.
			const interval = window.filter(
				({ role, start, end }) =>
					start >= after && (role === "user" || end <= at),
			);
			const user = interval.filter(({ role }) => role === "user");
			let burstStart = 0;
			for (let i = 1; i < user.length; i++)
				if (user[i]!.start - user[i - 1]!.end > TRANSCRIPT_GRACE_MS)
					burstStart = i;
			const latest = new Set(user.slice(burstStart));
			const input = Array.from(latest, ({ text }) => text).join("");
			if (!/[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(input)) {
				this.settled(id);
				this.unsent(id, "No new user speech could be matched to this request.");
				return;
			}
			const context = this.preparationContext(
				after,
				at,
				window,
				interval.filter((fragment) => !latest.has(fragment)),
				user.some(({ end }) => end > at),
			);
			if (
				Buffer.byteLength(input) + Buffer.byteLength(context) >
				MAX_REALTIME_VOICE_INPUT_BYTES
			) {
				this.settled(id);
				this.unsent(id, "The request transcript was too long to send intact.");
				return;
			}
			const turn: RealtimeVoiceTurn = {
				input,
				delegationId: id,
				...(context ? { transcriptDelta: context } : {}),
			};
			this.preparation = this.preparation.then(() =>
				this.prepare(delegation, turn, interval),
			);
			void this.preparation.catch((error: unknown) => {
				if (!this.abort.signal.aborted) this.onFailure(asError(error));
			});
		}, TRANSCRIPT_GRACE_MS);
	}

	private preparationContext(
		after: number,
		at: number,
		window: Fragment[],
		preceding: Fragment[],
		userOverlap: boolean,
	): string {
		// A short lookback resolves replies like "yes"; it must not authorize
		// previously handled or unmatched speech as a fresh instruction.
		const prior: Fragment[] = [];
		let bytes = 0;
		for (
			let index = this.fragments.length - 1;
			index >= 0 && prior.length < 64;
			index--
		) {
			const fragment = this.fragments[index]!;
			if (
				fragment.role === "user"
					? fragment.start >= after
					: fragment.end > after
			)
				continue;
			bytes += Buffer.byteLength(fragment.text) + 16;
			if (bytes > 4096) break;
			prior.push(fragment);
		}
		const earlier = render(prior.reverse());
		const dialogue = render(preceding);
		const overlap = render(
			window.filter(
				({ role, start, end }) =>
					role === "assistant" && (start < after || end > at),
			),
		);
		return [
			earlier ? `Earlier voice context, not a new request:\n${earlier}` : "",
			dialogue
				? `Other speech in this interval; may overlap the latest user speech:\n${dialogue}`
				: "",
			overlap
				? `Assistant speech crossing a request boundary; may overlap another interval:\n${overlap}`
				: "",
			userOverlap
				? "A user fragment spans the approximate delegation time and is included intact. Preserve corrections and uncertainty; do not infer separate requests or missing confirmations from that timing."
				: "",
		]
			.filter(Boolean)
			.join("\n");
	}

	private async prepare(
		delegation: Delegation,
		turn: RealtimeVoiceTurn,
		interval: Fragment[],
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
		this.finishInput(at);
		const endCall =
			prepared.endCall && this.isActive() && this.latestInputStart < at;
		if (endCall)
			this.callbacks.onEndCall?.(false, prepared.input ? id : undefined);
		// Submission is not a delivery receipt. Don't retry if the callback fails.
		if (prepared.input) {
			this.callbacks.onTurn({ input: prepared.input, delegationId: id });
			for (const fragment of interval) fragment.handled = true;
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
		if (!delegation.lateInput && this.latestInputStart < delegation.at)
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

	private boundTranscript(): void {
		if (this.bufferBytes <= MAX_BUFFER_BYTES) return;
		// Only discard handled fragments; the unhandled tail is retained on
		// failure rather than silently sending a clipped request.
		let keep = 0;
		for (const fragment of this.fragments) {
			if (this.bufferBytes > MAX_BUFFER_BYTES && fragment.handled)
				this.bufferBytes -= Buffer.byteLength(fragment.text) + 32;
			else this.fragments[keep++] = fragment;
		}
		this.fragments.length = keep;
		if (this.bufferBytes > MAX_BUFFER_BYTES)
			this.onFailure(
				new Error(
					"The voice transcript exceeded its buffer. Start a new call before repeating the request.",
				),
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
			if (type !== "session.thinking.append" && !this.observingOutput) {
				this.speakableResponsePending = true;
				this.armOutputTimer(OUTPUT_START_TIMEOUT_MS);
				this.lifecycle.onOutputChanged?.();
			}
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
		this.finishInput();
		this.finishOutput();
		const tail = render(this.fragments.filter(({ handled }) => !handled));
		this.fragments.length = 0;
		this.bufferBytes = 0;
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
