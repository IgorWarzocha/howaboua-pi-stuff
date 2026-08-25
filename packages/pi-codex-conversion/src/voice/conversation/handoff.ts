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
	private progressSpoken = false;
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
		this.settleDelegation();
		this.target = { type: "delegation", id };
		this.progressSpoken = false;
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
			this.settleDelegation();
			this.target = { type: "session" };
			this.progressSpoken = false;
		} else if (!this.target) {
			this.target = { type: "session" };
			this.progressSpoken = false;
		}
		if (!this.target) return;
		this.callbacks.onContext(this.target, "commentary", frame);
	}

	progress(content: string): void {
		const text = content.trim();
		if (!this.callbacks.isActive() || !this.target || !text) return;
		const channel = this.progressSpoken ? "commentary" : "speakable";
		this.callbacks.onContext(this.target, channel, text);
		this.progressSpoken = true;
	}

	result(content: string): void {
		const text = content.trim();
		if (!this.callbacks.isActive() || !this.target || !text) return;
		this.callbacks.onContext(this.target, "speakable", text);
	}

	settle(): void {
		this.settleDelegation();
		this.target = undefined;
		this.progressSpoken = false;
		this.clearQueuedInputs();
	}

	clear(): void {
		this.target = undefined;
		this.progressSpoken = false;
		this.clearQueuedInputs();
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
