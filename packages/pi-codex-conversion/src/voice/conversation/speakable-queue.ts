import type {
	RealtimeHandoffChannel,
	RealtimeHandoffKind,
	RealtimeHandoffTarget,
} from "./handoff.ts";

const MAX_PENDING_SPEAKABLE_CONTEXTS = 8;

interface PendingSpeakableContext {
	target: RealtimeHandoffTarget;
	content: string;
	kind: RealtimeHandoffKind | "announcement";
}

interface RealtimeSpeakableQueueCallbacks {
	onContext(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
	): void;
	onError(error: Error): void;
	onStatus(status: string): void;
}

/** Serializes realtime speech while preserving final Pi results across interruptions. */
export class RealtimeSpeakableQueue {
	private readonly callbacks: RealtimeSpeakableQueueCallbacks;
	private responsePending = false;
	private pending: PendingSpeakableContext[] = [];
	private userTurnPending = false;

	constructor(callbacks: RealtimeSpeakableQueueCallbacks) {
		this.callbacks = callbacks;
	}

	announce(content: string): void {
		this.enqueue({
			target: { type: "session" },
			content,
			kind: "announcement",
		});
	}

	appendHandoff(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
		kind?: RealtimeHandoffKind,
	): void {
		if (channel === "speakable" && kind) {
			this.enqueue({ target, content, kind });
			return;
		}
		this.callbacks.onContext(target, channel, content);
	}

	userInputStarted(): void {
		this.userTurnPending = true;
		this.pending = this.pending.filter(
			(context) => context.kind !== "progress",
		);
	}

	delegationStarted(): void {
		this.demoteSupersededSpeech();
	}

	userTurnCompleted(): void {
		this.demoteSupersededSpeech();
		this.userTurnPending = false;
		this.callbacks.onStatus("responding");
	}

	assistantTurnCompleted(): void {
		this.responsePending = false;
		if (this.userTurnPending) this.callbacks.onStatus("responding");
		else if (!this.flushNext()) this.callbacks.onStatus("listening");
	}

	agentSettled(): void {
		if (!this.responsePending && this.pending.length === 0)
			this.callbacks.onStatus("listening");
	}

	reset(): void {
		this.pending = [];
		this.responsePending = false;
		this.userTurnPending = false;
	}

	private demoteSupersededSpeech(): void {
		for (const context of this.pending) {
			if (context.kind === "result")
				this.callbacks.onContext(
					{ type: "session" },
					"commentary",
					context.content,
				);
		}
		this.pending = [];
	}

	private enqueue(context: PendingSpeakableContext): void {
		if (!this.responsePending && !this.userTurnPending) {
			this.send(context);
			return;
		}
		const queued = {
			...context,
			target: { type: "session" } as const,
		};
		if (context.kind === "progress") {
			const existing = this.pending.findLastIndex(
				(item) => item.kind === "progress",
			);
			if (existing >= 0) this.pending[existing] = queued;
			else this.pending.push(queued);
		} else {
			if (context.kind === "result")
				this.pending = this.pending.filter((item) => item.kind !== "progress");
			this.pending.push(queued);
		}
		while (this.pending.length > MAX_PENDING_SPEAKABLE_CONTEXTS) {
			const disposable = this.pending.findIndex(
				(item) => item.kind !== "result",
			);
			if (disposable < 0) {
				this.callbacks.onError(
					new Error("Realtime voice final-result queue overflow"),
				);
				return;
			}
			this.pending.splice(disposable, 1);
		}
	}

	private flushNext(): boolean {
		const next = this.pending.shift();
		if (!next) return false;
		this.send(next);
		return true;
	}

	private send(context: PendingSpeakableContext): void {
		this.responsePending = true;
		this.callbacks.onStatus("speaking");
		this.callbacks.onContext(context.target, "speakable", context.content);
	}
}
