import { MAX_REALTIME_VOICE_INPUT_BYTES } from "../prompts.ts";
import type { RealtimePlayback } from "./playback.ts";
import type { CodexConversationCallbacks } from "./session.ts";

export const TRANSCRIPT_GRACE_MS = 800;
const OUTPUT_QUIET_MS = 500;
const OUTPUT_START_TIMEOUT_MS = 10_000;
const MAX_BUFFER_BYTES = 16 * MAX_REALTIME_VOICE_INPUT_BYTES;

export interface ApiLiveLifecycle {
	onInputStarted?(): void;
	onInputChanged?(): void;
	onOutputFinished?(): void;
	onOutputChanged?(): void;
}

interface ApiLiveSpeechOptions {
	callbacks: Pick<
		CodexConversationCallbacks,
		"onUserTranscript" | "onTurn" | "onStatus"
	>;
	playback: RealtimePlayback;
	lifecycle: ApiLiveLifecycle;
	isActive(): boolean;
	signal: AbortSignal;
	onFailure(error: Error): void;
	onUserSpeech(): void;
}

type Role = "user" | "assistant";
interface Fragment {
	role: Role;
	text: string;
	start: number;
	end: number;
	handled?: true;
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

/** Derives captions, speech activity and delegation intervals from public GPT-Live fragments. */
export class ApiLiveSpeech {
	speakableResponsePending = false;
	private readonly fragments: Fragment[] = [];
	private bufferBytes = 0;
	private latestInputStart = -1;
	private inputCaption: Fragment[] = [];
	private outputCaption = "";
	private inputTimer: ReturnType<typeof setTimeout> | undefined;
	private outputTimer: ReturnType<typeof setTimeout> | undefined;
	private observingOutput = false;
	private heardOutput = false;

	private readonly options: ApiLiveSpeechOptions;

	constructor(options: ApiLiveSpeechOptions) {
		this.options = options;
	}

	get hasPendingInput(): boolean {
		return this.inputTimer !== undefined;
	}

	hasInputAtOrAfter(at: number): boolean {
		return this.latestInputStart >= at;
	}

	receiveFragment(
		role: Role,
		text: string,
		start: number,
		end: number,
		lastYield: number,
	): void {
		if (!text) return;
		const fragment: Fragment = { role, text, start, end };
		this.fragments.push(fragment);
		this.bufferBytes += Buffer.byteLength(text) + 32;
		if (role === "user") this.inputFragment(fragment, lastYield);
		else {
			this.outputCaption += text;
			if (text.trim()) this.observeOutput();
		}
		this.boundTranscript();
	}

	private inputFragment(fragment: Fragment, lastYield: number): void {
		const { text, start } = fragment;
		if (text.trim()) {
			const newSpeech = start >= Math.max(lastYield, this.latestInputStart);
			this.latestInputStart = Math.max(this.latestInputStart, start);
			if (newSpeech) this.options.lifecycle.onInputStarted?.();
			this.options.onUserSpeech();
		}
		const wasPending = this.hasPendingInput;
		this.inputCaption.push(fragment);
		clearTimeout(this.inputTimer);
		this.inputTimer = setTimeout(() => this.finishInput(), TRANSCRIPT_GRACE_MS);
		if (!wasPending) this.options.lifecycle.onInputChanged?.();
	}

	finishInput(at = Infinity): void {
		let caption = "";
		this.inputCaption = this.inputCaption.filter(({ text, start }) => {
			if (start >= at) return true;
			caption += text;
			return false;
		});
		if (!this.inputCaption.length && this.hasPendingInput) {
			clearTimeout(this.inputTimer);
			this.inputTimer = undefined;
			this.options.lifecycle.onInputChanged?.();
		}
		if (caption.trim()) this.options.callbacks.onUserTranscript(caption);
	}

	audioActivity(): void {
		this.options.playback.audioActivity();
		this.heardOutput = true;
		this.observeOutput();
	}

	expectOutput(): void {
		if (this.observingOutput) return;
		this.speakableResponsePending = true;
		this.armOutputTimer(OUTPUT_START_TIMEOUT_MS);
		this.options.lifecycle.onOutputChanged?.();
	}

	// On full-duplex Live, captions don't drive speaker suppression. A delayed
	// transcript is not an audio interruption signal.
	private observeOutput(): void {
		if (!this.observingOutput) {
			this.observingOutput = true;
			this.speakableResponsePending = true;
			this.options.playback.outputAdded();
			this.options.callbacks.onStatus("speaking");
			this.options.lifecycle.onOutputChanged?.();
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
		this.options.playback.outputFinished();
		const caption = this.outputCaption;
		this.outputCaption = "";
		if (caption.trim()) this.options.callbacks.onTurn({ input: caption });
		if (outputObserved && this.options.isActive())
			this.options.lifecycle.onOutputFinished?.();
		this.options.lifecycle.onOutputChanged?.();
		if (this.options.isActive() && !this.options.signal.aborted)
			this.options.callbacks.onStatus("listening");
	}

	captureInterval(after: number, at: number) {
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
			return { reason: "No new user speech could be matched to this request." };
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
			return { reason: "The request transcript was too long to send intact." };
		}
		return {
			input,
			context,
			markHandled() {
				for (const fragment of interval) fragment.handled = true;
			},
		};
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
			this.options.onFailure(
				new Error(
					"The voice transcript exceeded its buffer. Start a new call before repeating the request.",
				),
			);
	}

	drain(): string {
		this.finishInput();
		this.finishOutput();
		const tail = render(this.fragments.filter(({ handled }) => !handled));
		this.fragments.length = 0;
		this.bufferBytes = 0;
		return tail;
	}
}
