import { renderPiSteer } from "../prompts.ts";

export type RealtimeHandoffChannel = "commentary" | "speakable";
export type RealtimeHandoffKind = "progress" | "result";

export type RealtimeHandoffTarget =
	| { type: "delegation"; id: string }
	| { type: "session" };

interface RealtimeDelegationHandoffCallbacks {
	isActive(): boolean;
	onContext(
		target: RealtimeHandoffTarget,
		channel: RealtimeHandoffChannel,
		content: string,
		kind?: RealtimeHandoffKind,
	): void;
	onSettled(id: string): void;
}

/** Routes one Pi turn back into the active realtime conversation. */
export class RealtimeDelegationHandoff {
	private readonly callbacks: RealtimeDelegationHandoffCallbacks;
	private target: RealtimeHandoffTarget | undefined;
	private progressSpoken = false;

	constructor(callbacks: RealtimeDelegationHandoffCallbacks) {
		this.callbacks = callbacks;
	}

	activate(id: string): void {
		if (
			!this.callbacks.isActive() ||
			(this.target?.type === "delegation" && this.target.id === id)
		) return;
		this.settleDelegation();
		this.target = { type: "delegation", id };
		this.progressSpoken = false;
	}

	piInput(input: unknown, startsTurn: boolean): boolean {
		const frame = renderPiSteer(input);
		if (!this.callbacks.isActive() || !frame) return false;
		if (startsTurn) {
			this.settleDelegation();
			this.target = { type: "session" };
			this.progressSpoken = false;
		} else if (!this.target) {
			this.target = { type: "session" };
			this.progressSpoken = false;
		}
		if (!this.target) return false;
		this.callbacks.onContext(this.target, "commentary", frame);
		return true;
	}

	progress(content: string): void {
		const text = content.trim();
		if (!this.callbacks.isActive() || !this.target || !text) return;
		const channel = this.progressSpoken ? "commentary" : "speakable";
		this.callbacks.onContext(
			this.target,
			channel,
			text,
			channel === "speakable" ? "progress" : undefined,
		);
		this.progressSpoken = true;
	}

	result(content: string): void {
		const text = content.trim();
		if (!this.callbacks.isActive() || !this.target || !text) return;
		this.callbacks.onContext(this.target, "speakable", text, "result");
	}

	settle(): void {
		this.settleDelegation();
		this.target = undefined;
		this.progressSpoken = false;
	}

	clear(): void {
		this.target = undefined;
		this.progressSpoken = false;
	}

	private settleDelegation(): void {
		if (this.target?.type === "delegation")
			this.callbacks.onSettled(this.target.id);
	}
}
