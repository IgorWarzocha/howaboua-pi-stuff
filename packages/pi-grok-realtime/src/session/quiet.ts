/** Owns the quiet-receipt reconsideration timer; busy/mute state is read at scheduling. */
export class GrokQuietInterval {
	private quiet = false;
	private quietTimer: ReturnType<typeof setTimeout> | undefined;
	private readonly onReconsider: () => void;
	constructor(onReconsider: () => void) {
		this.onReconsider = onReconsider;
	}
	accept(): void {
		this.quiet = true;
	}
	clear(): void {
		this.quiet = false;
		this.cancel();
	}
	cancel(): void {
		clearTimeout(this.quietTimer);
		this.quietTimer = undefined;
	}

	reconsider(muted: boolean, piBusy: boolean, silenceSeconds: number): void {
		// A quiet tool receipt leaves xAI awaiting continuation, even after speech.
		if (!this.quiet || this.quietTimer || muted || piBusy || !silenceSeconds)
			return;
		this.quietTimer = setTimeout(() => {
			this.quietTimer = undefined;
			this.quiet = false;
			this.onReconsider();
		}, silenceSeconds * 1000);
		this.quietTimer.unref();
	}
}
