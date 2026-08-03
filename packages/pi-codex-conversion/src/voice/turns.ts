export interface RealtimeVoiceTurn {
	input: string;
	delegationId?: string;
}

const MAX_TRANSCRIPT_DELTA_BYTES = 32 * 1024;

interface TranscriptEntry {
	role: "user" | "assistant";
	text: string;
}

interface PendingDelegation {
	input: string;
	delegationId: string;
}

interface PendingUserTurn {
	delegation?: PendingDelegation;
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
	private unfinishedUserTurns: PendingUserTurn[] = [];
	private activeUserTurn: PendingUserTurn | undefined;
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	inputAdded(input: string): void {
		if (!this.activeUserTurn) {
			this.activeUserTurn = {};
			this.unfinishedUserTurns.push(this.activeUserTurn);
		}
		this.transcript.append("user", input);
	}

	outputAdded(output: string): void {
		this.transcript.append("assistant", output);
	}

	userFinished(input: string): RealtimeVoiceTurn | undefined {
		const turn = this.unfinishedUserTurns.shift();
		const wasActive = !turn || this.activeUserTurn === turn;
		if (this.activeUserTurn === turn) this.activeUserTurn = undefined;
		const delegation = turn?.delegation;
		if (delegation) {
			return {
				input: reconcileDelegationInput(delegation.input, input),
				delegationId: delegation.delegationId,
			};
		}
		if (wasActive) this.transcript.finish("user", input);
		this.pendingUserInputs.push(input);
		return undefined;
	}

	delegated(input: string, delegationId: string): RealtimeVoiceTurn | undefined {
		if (this.delegationIds.has(delegationId)) return undefined;
		this.delegationIds.add(delegationId);
		if (this.outstandingInputs.has(input)) return undefined;
		if (!this.activeUserTurn && this.pendingUserInputs.length === 0 && this.unfinishedUserTurns.some((turn) => turn.delegation)) return undefined;
		this.outstandingDelegations.set(delegationId, input);
		this.outstandingInputs.add(input);

		if (this.activeUserTurn) {
			this.activeUserTurn.delegation = { input, delegationId };
			this.activeUserTurn = undefined;
			this.transcript.reset();
			return undefined;
		}
		const pendingIndex = this.pendingUserInputs.length - 1;
		if (pendingIndex === -1) {
			this.unfinishedUserTurns.push({ delegation: { input, delegationId } });
			this.transcript.reset();
			return undefined;
		}
		const [transcript] = this.pendingUserInputs.splice(pendingIndex, 1);

		this.transcript.reset();
		return {
			input: reconcileDelegationInput(input, transcript),
			delegationId,
		};
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
		const turns = [
			...this.pendingUserInputs.map((input) => ({ input })),
			...this.unfinishedUserTurns.flatMap((turn) => turn.delegation ? [turn.delegation] : []),
		];
		this.pendingUserInputs = [];
		this.unfinishedUserTurns = [];
		this.activeUserTurn = undefined;
		return turns;
	}

	reset(): void {
		this.transcript.reset();
		this.pendingUserInputs = [];
		this.unfinishedUserTurns = [];
		this.activeUserTurn = undefined;
		this.delegationIds.clear();
		this.outstandingDelegations.clear();
		this.outstandingInputs.clear();
	}
}

function reconcileDelegationInput(delegation: string, transcript?: string): string {
	if (!transcript) return delegation;
	const normalizedDelegation = normalizeComparisonText(delegation);
	const normalizedTranscript = normalizeComparisonText(transcript);
	if (normalizedTranscript.includes(normalizedDelegation)) return transcript;
	if (normalizedDelegation.includes(normalizedTranscript)) return delegation;
	return `${delegation}\n\nVoice transcript: ${transcript}`;
}

function normalizeComparisonText(value: string): string {
	return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
