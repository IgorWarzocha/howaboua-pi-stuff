import type { AssistantMessage } from "@earendil-works/pi-ai";
import { renderPiSteer } from "../prompts.ts";
import type { CodexRealtimePeer } from "./peer.ts";
import { utf8Chunks } from "./wire.ts";

const HANDOFF_CHUNK_BYTES = 500;

export type RealtimeHandoffChannel = "commentary" | "speakable";

export function realtimeHandoffChannel(
	stopReason: AssistantMessage["stopReason"],
): RealtimeHandoffChannel {
	return stopReason === "toolUse" ? "commentary" : "speakable";
}

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

	constructor(peer: CodexRealtimePeer, callbacks: RealtimeDelegationHandoffCallbacks) {
		this.peer = peer;
		this.callbacks = callbacks;
	}

	activate(id: string): void {
		if (!this.callbacks.isActive() || this.activeDelegationId === id) return;
		const previousDelegationId = this.activeDelegationId;
		this.finishMessage("speakable");
		if (!this.callbacks.isActive()) return;
		if (previousDelegationId) this.callbacks.onSettled(previousDelegationId);
		this.activeDelegationId = id;
	}

	mirrorPiSteer(input: unknown): boolean {
		const delegationId = this.activeDelegationId;
		const frame = renderPiSteer(input);
		if (!this.callbacks.isActive() || !delegationId || !frame) return false;
		try {
			this.send(delegationId, "commentary", frame);
			return true;
		} catch (error) {
			this.callbacks.onFailure(asError(error));
			return false;
		}
	}

	stream(delta: string): void {
		if (!this.callbacks.isActive() || !this.activeDelegationId || !delta) return;
		this.buffer += delta;
	}

	finishMessage(channel: RealtimeHandoffChannel): void {
		const delegationId = this.activeDelegationId;
		const text = this.buffer;
		this.buffer = "";
		if (!this.callbacks.isActive() || !delegationId || !text) return;
		if (channel === "speakable") this.callbacks.onStatus("speaking");
		try {
			this.send(delegationId, channel, text);
		} catch (error) {
			this.callbacks.onFailure(asError(error));
		}
	}

	settle(): void {
		this.finishMessage("speakable");
		if (this.activeDelegationId) this.callbacks.onSettled(this.activeDelegationId);
		this.activeDelegationId = undefined;
		if (this.callbacks.isActive()) this.callbacks.onStatus("listening");
	}

	clear(): void {
		this.buffer = "";
		this.activeDelegationId = undefined;
	}

	private send(delegationId: string, channel: RealtimeHandoffChannel, content: string): void {
		for (const text of utf8Chunks(content, HANDOFF_CHUNK_BYTES)) {
			this.peer.sendData({ type: "delegation.context.append", delegation_item_id: delegationId, channel, content: [{ type: "input_text", text }] });
		}
	}
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
