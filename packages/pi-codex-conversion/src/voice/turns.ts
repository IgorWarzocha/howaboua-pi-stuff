export interface RealtimeVoiceTurn {
	input: string;
	delegationId?: string;
	transcriptDelta?: string;
}

const MAX_TRANSCRIPT_DELTA_BYTES = 32 * 1024;

interface TranscriptEntry {
	role: "user" | "assistant";
	text: string;
}

class RealtimeTranscriptBuffer {
	private entries: TranscriptEntry[] = [];

	append(role: TranscriptEntry["role"], transcript: string): void {
		const text = transcript.trim();
		if (!text) return;
		const last = this.entries.at(-1);
		if (last?.role === role) last.text += text;
		else this.entries.push({ role, text });
		this.bound();
	}

	finish(role: TranscriptEntry["role"], transcript: string): void {
		const text = transcript.trim();
		if (!text) return;
		const last = this.entries.at(-1);
		if (last?.role === role) last.text = text;
		else this.entries.push({ role, text });
		this.bound();
	}

	handoff(input: string): string | undefined {
		const normalized = input.trim();
		if (!this.entries.some((entry) => entry.role === "user" && entry.text.trim() === normalized)) {
			this.entries.push({ role: "user", text: normalized });
			this.bound();
		}
		return this.take();
	}

	take(): string | undefined {
		if (this.entries.length === 0) return undefined;
		const transcript = this.render();
		this.entries = [];
		return transcript;
	}

	reset(): void { this.entries = []; }

	private bound(): void {
		this.entries = this.entries.filter(
			(entry) => Buffer.byteLength(`${entry.role}: ${entry.text}`) <= MAX_TRANSCRIPT_DELTA_BYTES,
		);
		while (Buffer.byteLength(this.render()) > MAX_TRANSCRIPT_DELTA_BYTES) this.entries.shift();
	}

	private render(): string {
		return this.entries.map(({ role, text }) => `${role}: ${text}`).join("\n");
	}
}

/** Keeps conversational display turns separate from V3 delegation handoffs. */
export class RealtimeVoiceTurnTracker {
	private readonly transcript = new RealtimeTranscriptBuffer();
	private pendingUserInputs: string[] = [];
	private delegationsAwaitingUserFinish = 0;
	private userTranscriptOpen = false;
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	inputAdded(input: string): void {
		this.userTranscriptOpen = true;
		this.transcript.append("user", input);
	}

	outputAdded(output: string): void {
		this.transcript.append("assistant", output);
	}

	userFinished(input: string): RealtimeVoiceTurn | undefined {
		this.transcript.finish("user", input);
		this.userTranscriptOpen = false;
		if (this.delegationsAwaitingUserFinish > 0) {
			this.delegationsAwaitingUserFinish -= 1;
			return undefined;
		}
		this.pendingUserInputs.push(input);
		return undefined;
	}

	delegated(input: string, delegationId: string): RealtimeVoiceTurn | undefined {
		if (this.delegationIds.has(delegationId)) return undefined;
		this.delegationIds.add(delegationId);
		if (this.delegationIds.size > 128) this.delegationIds.delete(this.delegationIds.values().next().value!);
		if (this.outstandingInputs.has(input)) return undefined;
		this.outstandingDelegations.set(delegationId, input);
		this.outstandingInputs.add(input);

		const pendingIndex = this.userTranscriptOpen ? -1 : this.pendingUserInputs.length - 1;
		if (pendingIndex === -1) this.delegationsAwaitingUserFinish += 1;
		else this.pendingUserInputs.splice(pendingIndex, 1);

		const transcriptDelta = this.transcript.handoff(input);
		return { input, delegationId, ...(transcriptDelta ? { transcriptDelta } : {}) };
	}

	delegationSettled(delegationId: string): void {
		const input = this.outstandingDelegations.get(delegationId);
		if (input === undefined) return;
		this.outstandingDelegations.delete(delegationId);
		this.outstandingInputs.delete(input);
	}

	assistantFinished(output?: string): RealtimeVoiceTurn | undefined {
		if (output) this.transcript.finish("assistant", output);
		const input = this.pendingUserInputs.shift();
		return input === undefined ? undefined : { input };
	}

	takeTranscriptTail(): string | undefined { return this.transcript.take(); }

	drainConversationTurns(): RealtimeVoiceTurn[] {
		const turns = this.pendingUserInputs.map((input) => ({ input }));
		this.pendingUserInputs = [];
		return turns;
	}

	reset(): void {
		this.transcript.reset();
		this.pendingUserInputs = [];
		this.delegationsAwaitingUserFinish = 0;
		this.userTranscriptOpen = false;
		this.delegationIds.clear();
		this.outstandingDelegations.clear();
		this.outstandingInputs.clear();
	}
}
