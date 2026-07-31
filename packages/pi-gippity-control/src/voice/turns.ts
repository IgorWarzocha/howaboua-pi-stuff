export interface RealtimeVoiceTurn {
	input: string;
	delegationId?: string;
	transcriptDelta?: string;
}

const MAX_TRANSCRIPT_DELTA_BYTES = 32 * 1024;

class RealtimeTranscriptBuffer {
	private lines: string[] = [];

	append(role: "user" | "assistant", transcript: string): void {
		const line = `${role}: ${transcript.trim()}`;
		if (Buffer.byteLength(line) > MAX_TRANSCRIPT_DELTA_BYTES) return;
		this.lines.push(line);
		while (
			Buffer.byteLength(this.lines.join("\n")) > MAX_TRANSCRIPT_DELTA_BYTES
		)
			this.lines.shift();
	}

	take(): string | undefined {
		if (this.lines.length === 0) return undefined;
		const transcript = this.lines.join("\n");
		this.lines = [];
		return transcript;
	}

	reset(): void {
		this.lines = [];
	}
}

/** Correlates final user transcripts with the route V3 chose for each turn. */
export class RealtimeVoiceTurnTracker {
	private readonly transcript = new RealtimeTranscriptBuffer();
	private pendingUserInputs: string[] = [];
	private delegationsAwaitingTranscript = 0;
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	userFinished(input: string): void {
		this.transcript.append("user", input);
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
		const transcriptDelta = this.transcript.take();
		return {
			input,
			delegationId,
			...(transcriptDelta ? { transcriptDelta } : {}),
		};
	}

	delegationSettled(delegationId: string): void {
		const input = this.outstandingDelegations.get(delegationId);
		if (input === undefined) return;
		this.outstandingDelegations.delete(delegationId);
		this.outstandingInputs.delete(input);
	}

	assistantFinished(output?: string): RealtimeVoiceTurn | undefined {
		if (output) this.transcript.append("assistant", output);
		const input = this.pendingUserInputs.shift();
		return input === undefined ? undefined : { input };
	}

	takeTranscriptTail(): string | undefined {
		return this.transcript.take();
	}

	drainConversationTurns(): RealtimeVoiceTurn[] {
		const turns = this.pendingUserInputs.map((input) => ({ input }));
		this.pendingUserInputs = [];
		return turns;
	}

	reset(): void {
		this.transcript.reset();
		this.pendingUserInputs = [];
		this.delegationsAwaitingTranscript = 0;
		this.delegationIds.clear();
		this.outstandingDelegations.clear();
		this.outstandingInputs.clear();
	}
}
