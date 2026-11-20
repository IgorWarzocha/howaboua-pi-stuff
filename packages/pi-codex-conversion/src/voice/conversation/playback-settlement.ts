import type { CodexRealtimePeer } from "./peer.ts";

const PLAYBACK_WAIT_MS = 30_000;
const QUIET_MS = 500;

interface PlaybackOptions {
	minimumOutputs?: number;
	includeQueuedResponse?: boolean;
}

interface PlaybackState {
	isActive(): boolean;
	isEnding(): boolean;
	hasPendingOutput(includeQueuedResponse: boolean): boolean;
}

interface RefreshInput {
	nextChange(): Promise<void>;
	waitUntilSettled(signal: AbortSignal): Promise<void>;
}

/** Owns observed output completions and waits for the peer's quiet boundary. */
export class PlaybackSettlement {
	private readonly peer: CodexRealtimePeer;
	private readonly state: PlaybackState;
	private readonly checks = new Set<() => void>();
	private completed = 0;

	constructor(peer: CodexRealtimePeer, state: PlaybackState) {
		this.peer = peer;
		this.state = state;
	}

	get completedOutputs(): number {
		return this.completed;
	}

	recordOutputFinished(): void {
		this.completed++;
	}

	recheck(): void {
		for (const check of this.checks) check();
	}

	/** Quiet peer activity is best-effort: the helper has no speaker-drain acknowledgement. */
	waitForEnd(
		signal: AbortSignal,
		{ minimumOutputs = 0, includeQueuedResponse = false }: PlaybackOptions = {},
	): Promise<void> {
		signal.throwIfAborted();
		return new Promise((resolve, reject) => {
			let quiet: ReturnType<typeof setTimeout> | undefined;
			const finish = (error?: Error) => {
				clearTimeout(timeout);
				clearTimeout(quiet);
				removeEvent();
				removeExit();
				signal.removeEventListener("abort", aborted);
				this.checks.delete(check);
				if (error) reject(error);
				else resolve();
			};
			const check = () => {
				clearTimeout(quiet);
				if (minimumOutputs && !this.state.isEnding()) {
					finish(new Error("Call ending interrupted by new speech"));
					return;
				}
				if (!this.state.isActive()) {
					finish(new Error("The voice call closed before playback finished"));
					return;
				}
				if (
					this.completed >= minimumOutputs &&
					!this.state.hasPendingOutput(includeQueuedResponse)
				)
					quiet = setTimeout(() => finish(), QUIET_MS);
			};
			const aborted = () => finish(new Error("Playback wait cancelled"));
			const timeout = setTimeout(
				() =>
					finish(new Error("Voice output did not finish within 30 seconds")),
				PLAYBACK_WAIT_MS,
			);
			const removeEvent = this.peer.onEvent(check);
			const removeExit = this.peer.onExit(finish);
			this.checks.add(check);
			signal.addEventListener("abort", aborted, { once: true });
			check();
		});
	}

	async waitForRefresh(
		signal: AbortSignal,
		input: RefreshInput,
	): Promise<void> {
		await input.waitUntilSettled(signal);
		const deadline = AbortSignal.timeout(PLAYBACK_WAIT_MS);
		const playbackSignal = AbortSignal.any([signal, deadline]);
		try {
			for (;;) {
				const nextChange = input.nextChange();
				await this.waitForEnd(playbackSignal, { includeQueuedResponse: true });
				// Speech arriving during playback can queue another delegation or reply.
				if (nextChange === input.nextChange()) return;
				await input.waitUntilSettled(playbackSignal);
			}
		} catch (error) {
			if (deadline.aborted && !signal.aborted)
				throw new Error("Voice output did not settle within 30 seconds");
			throw error;
		}
	}
}
