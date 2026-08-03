export interface RealtimeVoiceTurn {
	input: string;
	transcriptDelta?: string;
	delegationId?: string;
}

const MAX_TRANSCRIPT_DELTA_BYTES = 32 * 1024;

interface TranscriptEntry {
	role: "user" | "assistant";
	text: string;
	final: boolean;
}

interface PendingDelegation {
	input: string;
	delegationId: string;
}

interface PendingUserTurn {
	delegation?: PendingDelegation;
}

interface PendingUserInput {
	input: string;
	transcript: TranscriptEntry;
}

class RealtimeTranscriptBuffer {
	private entries: TranscriptEntry[] = [];
	private readonly active = new Map<TranscriptEntry["role"], TranscriptEntry>();

	append(
		role: TranscriptEntry["role"],
		transcript: string,
		startsTurn = false,
	): void {
		const text = transcript.trim();
		if (!text) return;
		const current = this.active.get(role);
		if (current && !startsTurn) current.text += text;
		else {
			const entry = { role, text, final: false };
			this.entries.push(entry);
			this.active.set(role, entry);
		}
		this.bound();
	}

	finish(role: TranscriptEntry["role"], transcript: string): TranscriptEntry {
		const text = transcript.trim();
		const current = this.entries.find(
			(entry) => entry.role === role && !entry.final,
		);
		if (current) {
			current.text = text;
			current.final = true;
			if (this.active.get(role) === current) this.active.delete(role);
		} else {
			const entry = { role, text, final: true };
			this.entries.push(entry);
			this.bound();
			return entry;
		}
		this.bound();
		return current;
	}

	take(): string | undefined {
		if (this.entries.length === 0) return undefined;
		const transcript = this.render();
		this.reset();
		return transcript;
	}

	takeHistoryBefore(currentUser: TranscriptEntry): string | undefined {
		const currentUserIndex = this.entries.indexOf(currentUser);
		const history =
			currentUserIndex < 0
				? []
				: this.entries.slice(0, currentUserIndex).filter(({ final }) => final);
		const transcript = this.render(history);
		this.reset();
		return transcript || undefined;
	}

	reset(): void {
		this.entries = [];
		this.active.clear();
	}

	private bound(): void {
		this.entries = this.entries.filter(
			(entry) =>
				Buffer.byteLength(`${entry.role}: ${entry.text}`) <=
				MAX_TRANSCRIPT_DELTA_BYTES,
		);
		while (Buffer.byteLength(this.render()) > MAX_TRANSCRIPT_DELTA_BYTES)
			this.entries.shift();
		for (const [role, entry] of this.active)
			if (!this.entries.includes(entry)) this.active.delete(role);
	}

	private render(entries = this.entries): string {
		return entries.map(({ role, text }) => `${role}: ${text}`).join("\n");
	}
}

/** Keeps conversational display turns separate from V3 delegation handoffs. */
export class RealtimeVoiceTurnTracker {
	private readonly transcript = new RealtimeTranscriptBuffer();
	private pendingUserInputs: PendingUserInput[] = [];
	private unfinishedUserTurns: PendingUserTurn[] = [];
	private activeUserTurn: PendingUserTurn | undefined;
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	inputAdded(input: string): void {
		const startsTurn = !this.activeUserTurn;
		if (!this.activeUserTurn) {
			this.activeUserTurn = {};
			this.unfinishedUserTurns.push(this.activeUserTurn);
		}
		this.transcript.append("user", input, startsTurn);
	}

	outputAdded(output: string): void {
		this.transcript.append("assistant", output);
	}

	userFinished(input: string): RealtimeVoiceTurn | undefined {
		const turn = this.unfinishedUserTurns.shift();
		if (this.activeUserTurn === turn) this.activeUserTurn = undefined;
		const transcript = this.transcript.finish("user", input);
		const delegation = turn?.delegation;
		if (delegation) return this.finishDelegation(delegation, transcript);
		this.pendingUserInputs.push({ input, transcript });
		return undefined;
	}

	delegated(
		input: string,
		delegationId: string,
	): RealtimeVoiceTurn | undefined {
		if (this.delegationIds.has(delegationId)) return undefined;
		this.delegationIds.add(delegationId);
		if (this.outstandingInputs.has(input)) return undefined;
		if (this.activeUserTurn?.delegation) return undefined;
		if (
			!this.activeUserTurn &&
			this.pendingUserInputs.length === 0 &&
			this.unfinishedUserTurns.some((turn) => turn.delegation)
		)
			return undefined;
		this.outstandingDelegations.set(delegationId, input);
		this.outstandingInputs.add(input);

		if (this.activeUserTurn) {
			this.activeUserTurn.delegation = { input, delegationId };
			return undefined;
		}
		const pendingIndex = this.pendingUserInputs.length - 1;
		if (pendingIndex === -1) {
			this.unfinishedUserTurns.push({ delegation: { input, delegationId } });
			return undefined;
		}
		const [pending] = this.pendingUserInputs.splice(pendingIndex, 1);
		return this.finishDelegation({ input, delegationId }, pending!.transcript);
	}

	delegationSettled(delegationId: string): void {
		const input = this.outstandingDelegations.get(delegationId);
		if (input === undefined) return;
		this.outstandingDelegations.delete(delegationId);
		this.outstandingInputs.delete(input);
	}

	assistantFinished(output?: string): RealtimeVoiceTurn | undefined {
		if (output) this.transcript.finish("assistant", output);
		this.pendingUserInputs.shift();
		return output ? { input: output } : undefined;
	}

	takeTranscriptTail(): string | undefined {
		return this.transcript.take();
	}

	drainConversationTurns(): RealtimeVoiceTurn[] {
		const turns = this.unfinishedUserTurns.flatMap((turn) =>
			turn.delegation ? [turn.delegation] : [],
		);
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

	private finishDelegation(
		delegation: PendingDelegation,
		currentUser: TranscriptEntry,
	): RealtimeVoiceTurn {
		const transcriptDelta = this.transcript.takeHistoryBefore(currentUser);
		return {
			input: delegation.input,
			...(transcriptDelta ? { transcriptDelta } : {}),
			delegationId: delegation.delegationId,
		};
	}
}
