interface AudioCallbacks {
	onAudio(pcm: Buffer): void;
	onError(error: Error): void;
}

export interface RealtimeAudio {
	start(callbacks: AudioCallbacks): Promise<void>;
	play(pcm: Buffer): void;
	clear(): void;
	drain(): Promise<void>;
	setMuted(muted: boolean): void;
	close(): Promise<void>;
}
