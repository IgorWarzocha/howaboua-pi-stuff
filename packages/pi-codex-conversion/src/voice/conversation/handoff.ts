import { renderPiSteer } from "../prompts.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { utf8Chunks } from "./wire.ts";

const HANDOFF_CHUNK_BYTES = 500;
const HANDOFF_FLUSH_MS = 200;

interface RealtimeDelegationHandoffCallbacks {
	isActive(): boolean;
	onFailure(error: Error): void;
	onSettled(id: string): void;
	onStatus(status: string): void;
}

export class RealtimeDelegationHandoff {
	private readonly peer: CodexRealtimePeer;
	private readonly callbacks: RealtimeDelegationHandoffCallbacks;
	private activeDelegationId: string | undefined;
	private buffer = "";
	private channel: "commentary" | "speakable" = "speakable";
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(peer: CodexRealtimePeer, callbacks: RealtimeDelegationHandoffCallbacks) {
		this.peer = peer;
		this.callbacks = callbacks;
	}

	activate(id: string): void {
		if (!this.callbacks.isActive() || this.activeDelegationId === id) return;
		const previousDelegationId = this.activeDelegationId;
		this.flush();
		if (!this.callbacks.isActive()) return;
		if (previousDelegationId) this.callbacks.onSettled(previousDelegationId);
		this.activeDelegationId = id;
	}

	mirrorPiSteer(input: unknown): boolean {
		const delegationId = this.activeDelegationId;
		const frame = renderPiSteer(input);
		if (!this.callbacks.isActive() || !delegationId || !frame) return false;
		this.flush();
		if (!this.callbacks.isActive() || this.activeDelegationId !== delegationId) return false;
		try {
			this.send(delegationId, "commentary", frame);
			return true;
		} catch (error) {
			this.callbacks.onFailure(asError(error));
			return false;
		}
	}

	stream(type: string, delta: string): void {
		if (!this.callbacks.isActive() || !this.activeDelegationId || !delta) return;
		this.callbacks.onStatus("speaking");
		const channel = type === "thinking_delta" ? "commentary" : "speakable";
		if (this.buffer && channel !== this.channel) this.flush();
		this.channel = channel;
		this.buffer += delta;
		if (!this.timer) this.timer = setTimeout(() => this.flush(), HANDOFF_FLUSH_MS);
	}

	settle(): void {
		this.flush();
		if (this.activeDelegationId) this.callbacks.onSettled(this.activeDelegationId);
		this.activeDelegationId = undefined;
		if (this.callbacks.isActive()) this.callbacks.onStatus("listening");
	}

	flush(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		if (!this.callbacks.isActive() || !this.activeDelegationId || !this.buffer) return;
		try {
			this.send(this.activeDelegationId, this.channel, this.buffer);
			this.buffer = "";
		} catch (error) {
			this.callbacks.onFailure(asError(error));
		}
	}

	clear(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
		this.buffer = "";
		this.activeDelegationId = undefined;
	}

	private send(delegationId: string, channel: "commentary" | "speakable", content: string): void {
		for (const text of utf8Chunks(content, HANDOFF_CHUNK_BYTES)) {
			this.peer.sendData({ type: "delegation.context.append", delegation_item_id: delegationId, channel, content: [{ type: "input_text", text }] });
		}
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
