export interface RealtimeVoiceTurn {
	input: string;
	delegationId?: string;
}

/** Correlates final user transcripts with the route V3 chose for each turn. */
export class RealtimeVoiceTurnTracker {
	private pendingUserInputs: string[] = [];
	private delegationsAwaitingTranscript = 0;
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	userFinished(input: string): void {
		if (this.delegationsAwaitingTranscript > 0) {
			this.delegationsAwaitingTranscript--;
			return;
		}
		this.pendingUserInputs.push(input);
	}

	delegated(
		input: string,
		delegationId: string,
	): RealtimeVoiceTurn | undefined {
		if (this.delegationIds.has(delegationId)) return undefined;
		this.delegationIds.add(delegationId);
		if (this.delegationIds.size > 128)
			this.delegationIds.delete(this.delegationIds.values().next().value!);
		if (this.outstandingInputs.has(input)) return undefined;
		this.outstandingDelegations.set(delegationId, input);
		this.outstandingInputs.add(input);
		if (this.pendingUserInputs.length > 0) this.pendingUserInputs.shift();
		else this.delegationsAwaitingTranscript++;
		return { input, delegationId };
	}

	delegationSettled(delegationId: string): void {
		const input = this.outstandingDelegations.get(delegationId);
		if (input === undefined) return;
		this.outstandingDelegations.delete(delegationId);
		this.outstandingInputs.delete(input);
	}

	assistantFinished(): RealtimeVoiceTurn | undefined {
		const input = this.pendingUserInputs.shift();
		return input === undefined ? undefined : { input };
	}

	reset(): void {
		this.pendingUserInputs = [];
		this.delegationsAwaitingTranscript = 0;
		this.delegationIds.clear();
		this.outstandingDelegations.clear();
		this.outstandingInputs.clear();
	}
}
