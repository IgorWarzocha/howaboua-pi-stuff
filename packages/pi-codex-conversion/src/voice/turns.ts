export interface RealtimeVoiceTurn {
	input: string;
	delegationId?: string;
}

/** Correlates final user transcripts with the route V3 chose for each turn. */
export class RealtimeVoiceTurnTracker {
	private pendingUserInputs: string[] = [];
	private delegationsAwaitingTranscript = 0;

	userFinished(input: string): void {
		if (this.delegationsAwaitingTranscript > 0) {
			this.delegationsAwaitingTranscript--;
			return;
		}
		this.pendingUserInputs.push(input);
	}

	delegated(input: string, delegationId: string): RealtimeVoiceTurn {
		if (this.pendingUserInputs.length > 0) this.pendingUserInputs.shift();
		else this.delegationsAwaitingTranscript++;
		return { input, delegationId };
	}

	assistantFinished(): RealtimeVoiceTurn | undefined {
		const input = this.pendingUserInputs.shift();
		return input === undefined ? undefined : { input };
	}

	reset(): void {
		this.pendingUserInputs = [];
		this.delegationsAwaitingTranscript = 0;
	}
}
