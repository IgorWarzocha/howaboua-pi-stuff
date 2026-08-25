import { renderPiSteer } from "../prompts.ts";

export type RealtimeHandoffChannel = "commentary" | "speakable";
export type RealtimePiInputBehavior = "steer" | "followUp";

export type RealtimeHandoffTarget =
	| { type: "delegation"; id: string }
	| { type: "session" };

interface RealtimeDelegationHandoffCallbacks {
	isActive(): boolean;
	onContext(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
	): void;
	onSettled(id: string): void;
}

/** Routes one Pi turn back into the active realtime conversation. */
export class RealtimeDelegationHandoff {
	private readonly callbacks: RealtimeDelegationHandoffCallbacks;
	private target: RealtimeHandoffTarget | undefined;
	private buffer = "";
	private streamedProgress = false;
	private readonly queuedSteers: string[] = [];
	private readonly queuedFollowUps: Array<{ input: string; frame: string }> =
		[];

	constructor(callbacks: RealtimeDelegationHandoffCallbacks) {
		this.callbacks = callbacks;
	}

	activate(id: string): void {
		if (
			!this.callbacks.isActive() ||
			(this.target?.type === "delegation" && this.target.id === id)
		)
			return;
		this.finishResult();
		if (!this.callbacks.isActive()) return;
		this.settleDelegation();
		this.target = { type: "delegation", id };
	}

	piInput(
		input: unknown,
		streamingBehavior?: RealtimePiInputBehavior,
	): boolean {
		const frame = renderPiSteer(input);
		if (!this.callbacks.isActive() || !frame || typeof input !== "string")
			return false;
		const normalizedInput = input.trim();
		if (streamingBehavior === "followUp") {
			this.queuedFollowUps.push({ input: normalizedInput, frame });
			return true;
		}
		if (streamingBehavior === "steer") this.queuedSteers.push(normalizedInput);
		this.routePiInput(frame, streamingBehavior === undefined);
		return true;
	}

	piUserMessage(message: unknown): boolean {
		if (!this.callbacks.isActive()) return false;
		const input = userMessageText(message);
		if (!input) return false;
		const steerIndex = this.queuedSteers.indexOf(input);
		if (steerIndex >= 0) {
			this.queuedSteers.splice(steerIndex, 1);
			return true;
		}
		const followUpIndex = this.queuedFollowUps.findIndex(
			(pending) => pending.input === input,
		);
		if (followUpIndex < 0) return false;
		const [pending] = this.queuedFollowUps.splice(followUpIndex, 1);
		if (!pending) return false;
		this.routePiInput(pending.frame, true);
		return true;
	}

	private routePiInput(frame: string, startsTurn: boolean): void {
		if (startsTurn) {
			this.finishResult();
			this.settleDelegation();
			this.target = { type: "session" };
		} else if (!this.target) {
			this.target = { type: "session" };
		}
		if (!this.target) return;
		this.callbacks.onContext(this.target, "commentary", frame);
	}

	stream(delta: string): void {
		if (!this.callbacks.isActive() || !this.target || !delta) return;
		this.buffer += delta;
		for (;;) {
			const boundary = this.streamedProgress
				? paragraphBoundary(this.buffer)
				: secondSentenceBoundary(this.buffer);
			if (boundary === undefined) break;
			const chunk = this.buffer.slice(0, boundary);
			this.buffer = this.buffer.slice(boundary);
			if (chunk.trim()) {
				this.callbacks.onContext({ type: "session" }, "speakable", chunk);
				this.streamedProgress = true;
			}
		}
	}

	progress(content: string): void {
		this.finishProgress(content);
	}

	result(content: string): void {
		this.finishResult(content);
	}

	settle(): void {
		this.finishResult();
		this.settleDelegation();
		this.target = undefined;
		this.clearQueuedInputs();
	}

	clear(): void {
		this.target = undefined;
		this.buffer = "";
		this.streamedProgress = false;
		this.clearQueuedInputs();
	}

	private finishProgress(fallback = ""): void {
		const text = (this.streamedProgress ? this.buffer : fallback).trim();
		this.buffer = "";
		this.streamedProgress = false;
		if (!this.callbacks.isActive() || !this.target || !text) return;
		this.callbacks.onContext({ type: "session" }, "speakable", text);
	}

	private finishResult(fallback = ""): void {
		if (this.streamedProgress) {
			this.finishProgress();
			return;
		}
		const text = (fallback || this.buffer).trim();
		this.buffer = "";
		if (!this.callbacks.isActive() || !this.target || !text) return;
		this.callbacks.onContext(this.target, "speakable", text);
	}

	private clearQueuedInputs(): void {
		this.queuedSteers.length = 0;
		this.queuedFollowUps.length = 0;
	}

	private settleDelegation(): void {
		if (this.target?.type === "delegation")
			this.callbacks.onSettled(this.target.id);
	}
}

function secondSentenceBoundary(text: string): number | undefined {
	const ends = [...text.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)];
	return ends[1]?.index === undefined
		? undefined
		: ends[1].index + ends[1][0].length;
}

function paragraphBoundary(text: string): number | undefined {
	const match = /\n\s*\n/.exec(text);
	return match?.index === undefined ? undefined : match.index + match[0].length;
}

function userMessageText(message: unknown): string | undefined {
	if (!message || typeof message !== "object") return undefined;
	const candidate = message as {
		role?: unknown;
		content?: unknown;
	};
	if (candidate.role !== "user") return undefined;
	if (typeof candidate.content === "string")
		return candidate.content.trim() || undefined;
	if (!Array.isArray(candidate.content)) return undefined;
	const text = candidate.content
		.flatMap((part) =>
			part &&
			typeof part === "object" &&
			(part as { type?: unknown }).type === "text" &&
			typeof (part as { text?: unknown }).text === "string"
				? [(part as { text: string }).text]
				: [],
		)
		.join("\n")
		.trim();
	return text || undefined;
}
