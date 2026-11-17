const SPEAKER_ACTIVITY_HOLD_MS = 500;

/** Retires audible output on spoken interruption without changing Pi turn routing. */
export class RealtimePlayback {
	private inputActive = false;
	private inputGeneration = 0;
	private assistantGeneration: number | undefined;
	private speakerActiveUntil = 0;
	private suppressed = false;

	private readonly setSuppressed: (suppressed: boolean) => void;

	constructor(setSuppressed: (suppressed: boolean) => void) {
		this.setSuppressed = setSuppressed;
	}

	audioActivity(): void {
		if (!this.suppressed)
			this.speakerActiveUntil = Date.now() + SPEAKER_ACTIVITY_HOLD_MS;
	}

	inputStarted(speechPending: boolean): void {
		if (this.inputActive) return;
		this.inputActive = true;
		this.inputGeneration++;
		// Quiet turns must accept their first audio before captions arrive.
		if (
			this.assistantGeneration !== undefined ||
			speechPending ||
			this.speakerActiveUntil > Date.now() ||
			this.suppressed
		)
			this.suppress(true);
	}

	inputFinished(speechPending: boolean, hasTranscript: boolean): void {
		if (!this.inputActive && !hasTranscript) return;
		this.inputStarted(speechPending);
		this.inputActive = false;
		this.releaseCurrentOutput();
	}

	outputAdded(): void {
		this.assistantGeneration ??= this.inputGeneration;
		this.releaseCurrentOutput();
	}

	outputFinished(): void {
		// A final-only caption has no generation owner. It cannot release stale audio.
		this.assistantGeneration = undefined;
	}

	private releaseCurrentOutput(): void {
		if (!this.inputActive && this.assistantGeneration === this.inputGeneration)
			this.suppress(false);
	}

	private suppress(suppressed: boolean): void {
		if (this.suppressed === suppressed) return;
		this.setSuppressed(suppressed);
		this.suppressed = suppressed;
		this.speakerActiveUntil = 0;
	}
}
