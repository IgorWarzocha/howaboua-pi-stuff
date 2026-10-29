export interface RealtimeVoiceTurn {
	input: string;
	transcriptDelta?: string;
	delegationId?: string;
}

export interface TrackedRealtimeDelegation {
	turn: RealtimeVoiceTurn;
	displayInput: boolean;
}

const MAX_TRANSCRIPT_DELTA_BYTES = 32 * 1024;

interface TranscriptEntry {
	role: "user" | "assistant";
	text: string;
	final: boolean;
	consumedText?: string;
}

interface PendingDelegation {
	input: string;
	delegationId: string;
}

interface PendingUserInput {
	input: string;
	transcript: TranscriptEntry;
}

class RealtimeTranscriptBuffer {
	private entries: TranscriptEntry[] = [];
	private readonly active = new Map<TranscriptEntry["role"], TranscriptEntry>();
	private readonly preserveInterval: boolean;
	constructor(preserveInterval = false) {
		this.preserveInterval = preserveInterval;
	}

	append(
		role: TranscriptEntry["role"],
		transcript: string,
		startsTurn = false,
	): void {
		const text = this.preserveInterval ? transcript : transcript.trim();
		if (!text.trim()) return;
		const current = this.active.get(role);
		if (current && !startsTurn) current.text += text;
		else {
			const entry = { role, text, final: false };
			this.entries.push(entry);
			this.active.set(role, entry);
		}
		if (!this.preserveInterval) this.bound();
	}

	finish(role: TranscriptEntry["role"], transcript: string): TranscriptEntry {
		const text = this.preserveInterval ? transcript : transcript.trim();
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
			if (!this.preserveInterval) this.bound();
			return entry;
		}
		if (!this.preserveInterval) this.bound();
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

	takeInterval(currentUser?: TranscriptEntry): { text?: string } {
		const user = currentUser ?? this.active.get("user");
		const interval = this.entries.filter((entry) => entry !== user);
		const text = this.render(interval);
		// Keep in-flight assistant boundaries for late finals. The yielded user
		// input is already authoritative; transcript revisions must not block it.
		this.entries = interval.filter(
			(entry) => !entry.final && entry.role === "assistant",
		);
		this.active.clear();
		for (const entry of this.entries) {
			entry.consumedText = entry.text;
			this.active.set(entry.role, entry);
		}
		return text ? { text } : {};
	}

	takeFinalized(): string | undefined {
		const transcript = this.render(this.entries.filter(({ final }) => final));
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
		return entries
			.flatMap(({ role, text, consumedText }) => {
				let remaining = text;
				if (this.preserveInterval && consumedText) {
					if (text.startsWith(consumedText))
						remaining = text.slice(consumedText.length);
					else {
						const normalized = text.replace(/\s+/g, " ").trim();
						const consumed = consumedText.replace(/\s+/g, " ").trim();
						// A consumed trailing space must remain a word boundary.
						const boundary =
							!/\s$/.test(consumedText) ||
							normalized.length === consumed.length ||
							/\s/.test(normalized.charAt(consumed.length));
						remaining =
							normalized.startsWith(consumed) && boundary
								? normalized.slice(consumed.length)
								: `[Revised earlier speech; may overlap the previous request]\n${text}`;
					}
				}
				return remaining.trim() ? [`${role}: ${remaining}`] : [];
			})
			.join("\n");
	}
}

/** Keeps conversational display turns separate from V3 delegation handoffs. */
export class RealtimeVoiceTurnTracker {
	private readonly transcript: RealtimeTranscriptBuffer;
	private readonly preserveInterval: boolean;
	constructor(preserveInterval = false) {
		this.preserveInterval = preserveInterval;
		this.transcript = new RealtimeTranscriptBuffer(preserveInterval);
	}
	private pendingUserInputs: PendingUserInput[] = [];
	private recentlyAnsweredUserInput: PendingUserInput | undefined;
	private unfinishedUserTurns: object[] = [];
	private activeUserTurn: object | undefined;
	private delegatedUserFinishes = 0;
	private readonly delegatedUserTurns = new Set<object>();
	private readonly delegationIds = new Set<string>();
	private readonly outstandingDelegations = new Map<string, string>();
	private readonly outstandingInputs = new Set<string>();

	get hasPendingInput(): boolean {
		return this.unfinishedUserTurns.length > 0 || this.pendingUserInputs.length > 0;
	}

	inputStarted(): void {
		if (!this.activeUserTurn) {
			this.recentlyAnsweredUserInput = undefined;
			this.activeUserTurn = {};
			this.unfinishedUserTurns.push(this.activeUserTurn);
		}
	}

	inputAdded(input: string): void {
		const startsTurn = !this.activeUserTurn;
		this.inputStarted();
		this.transcript.append("user", input, startsTurn);
	}

	outputAdded(output: string): void {
		this.transcript.append("assistant", output);
	}

	userFinished(input: string): boolean {
		if (!this.preserveInterval && this.delegatedUserFinishes > 0) {
			this.delegatedUserFinishes -= 1;
			return false;
		}
		const turn = this.unfinishedUserTurns.shift();
		if (this.activeUserTurn === turn) this.activeUserTurn = undefined;
		if (turn && this.delegatedUserTurns.delete(turn)) return false;
		const transcript = this.transcript.finish("user", input);
		this.pendingUserInputs.push({ input, transcript });
		return true;
	}

	delegated(
		input: string,
		delegationId: string,
	): TrackedRealtimeDelegation | undefined {
		if (this.delegationIds.has(delegationId)) return undefined;
		this.delegationIds.add(delegationId);
		if (!this.preserveInterval && this.outstandingInputs.has(input))
			return undefined;
		this.outstandingDelegations.set(delegationId, input);
		this.outstandingInputs.add(input);

		if (this.activeUserTurn) {
			const active = this.activeUserTurn;
			this.activeUserTurn = undefined;
			if (this.preserveInterval) this.delegatedUserTurns.add(active);
			else {
				this.unfinishedUserTurns = this.unfinishedUserTurns.filter(
					(turn) => turn !== active,
				);
				this.delegatedUserFinishes += 1;
			}
			return {
				turn: this.finishDelegation({ input, delegationId }),
				displayInput: true,
			};
		}
		const pendingIndex = this.pendingUserInputs.length - 1;
		if (pendingIndex === -1) {
			if (this.recentlyAnsweredUserInput) {
				const answered = this.recentlyAnsweredUserInput;
				this.recentlyAnsweredUserInput = undefined;
				return {
					turn: this.finishDelegation(
						{ input, delegationId },
						answered.transcript,
					),
					displayInput: false,
				};
			}
			if (!this.preserveInterval) this.delegatedUserFinishes += 1;
			return {
				turn: this.finishDelegation({ input, delegationId }),
				displayInput: true,
			};
		}
		const [pending] = this.pendingUserInputs.splice(pendingIndex, 1);
		this.recentlyAnsweredUserInput = undefined;
		return {
			turn: this.finishDelegation({ input, delegationId }, pending!.transcript),
			displayInput: false,
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
		const answered = this.pendingUserInputs.shift();
		if (answered) this.recentlyAnsweredUserInput = answered;
		return output ? { input: output } : undefined;
	}

	takeTranscriptTail(): string | undefined {
		return this.transcript.take();
	}

	drainConversationTurns(): RealtimeVoiceTurn[] {
		this.pendingUserInputs = [];
		this.recentlyAnsweredUserInput = undefined;
		this.unfinishedUserTurns = [];
		this.activeUserTurn = undefined;
		this.delegatedUserFinishes = 0;
		this.delegatedUserTurns.clear();
		return [];
	}

	reset(): void {
		this.transcript.reset();
		this.pendingUserInputs = [];
		this.recentlyAnsweredUserInput = undefined;
		this.unfinishedUserTurns = [];
		this.activeUserTurn = undefined;
		this.delegatedUserFinishes = 0;
		this.delegatedUserTurns.clear();
		this.delegationIds.clear();
		this.outstandingDelegations.clear();
		this.outstandingInputs.clear();
	}

	private finishDelegation(
		delegation: PendingDelegation,
		currentUser?: TranscriptEntry,
	): RealtimeVoiceTurn {
		const interval = this.preserveInterval
			? this.transcript.takeInterval(currentUser)
			: undefined;
		const transcriptDelta = interval
			? interval.text
			: currentUser
				? this.transcript.takeHistoryBefore(currentUser)
				: this.transcript.takeFinalized();
		return {
			input: delegation.input,
			...(transcriptDelta ? { transcriptDelta } : {}),
			delegationId: delegation.delegationId,
		};
	}
}
