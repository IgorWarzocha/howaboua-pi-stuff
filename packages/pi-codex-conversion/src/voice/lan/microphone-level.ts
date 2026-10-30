const MICROPHONE_RATE = 24_000;
const DETECTABLE_PEAK = 82;
const HEALTHY_PEAK = 655;

export class MicrophoneLevelMonitor {
	private readonly onChange: (inputTooQuiet: boolean) => void;
	private samples = 0;
	private peak = 0;
	private inputTooQuiet = false;

	constructor(onChange: (inputTooQuiet: boolean) => void) {
		this.onChange = onChange;
	}

	append(pcm: Buffer): void {
		let framePeak = 0;
		for (let offset = 0; offset + 1 < pcm.byteLength; offset += 2)
			framePeak = Math.max(framePeak, Math.abs(pcm.readInt16LE(offset)));
		if (framePeak >= HEALTHY_PEAK) {
			this.samples = 0;
			this.peak = 0;
			this.set(false);
			return;
		}
		this.samples += Math.floor(pcm.byteLength / 2);
		this.peak = Math.max(this.peak, framePeak);
		if (this.samples < MICROPHONE_RATE) return;
		if (this.peak >= DETECTABLE_PEAK) this.set(true);
		this.samples = 0;
		this.peak = 0;
	}

	reset(): void {
		this.samples = 0;
		this.peak = 0;
		this.set(false);
	}

	private set(inputTooQuiet: boolean): void {
		if (this.inputTooQuiet === inputTooQuiet) return;
		this.inputTooQuiet = inputTooQuiet;
		this.onChange(inputTooQuiet);
	}
}
