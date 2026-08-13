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
	private streamedProgress = false;

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
		for (;;) {
			const boundary = this.streamedProgress
				? paragraphBoundary(this.buffer)
				: secondSentenceBoundary(this.buffer);
			if (boundary === undefined) break;
			const chunk = this.buffer.slice(0, boundary);
			this.buffer = this.buffer.slice(boundary);
			if (chunk.trim()) this.sendProgress(chunk);
		}
	}

	finishMessage(channel: RealtimeHandoffChannel, fallback = ""): void {
		const delegationId = this.activeDelegationId;
		const text = fallback || this.buffer;
		this.buffer = "";
		this.streamedProgress = false;
		if (!this.callbacks.isActive() || !delegationId || !text) return;
		if (channel === "speakable") this.callbacks.onStatus("speaking");
		try {
			this.send(delegationId, channel, text);
		} catch (error) {
			this.callbacks.onFailure(asError(error));
		}
	}

	finishProgress(fallback = ""): void {
		const text = fallback || this.buffer;
		this.buffer = "";
		const active = this.callbacks.isActive() && Boolean(this.activeDelegationId);
		if (active && text) this.sendProgress(text, false);
		this.streamedProgress = false;
	}

	hasStreamedProgress(): boolean {
		return this.streamedProgress;
	}

	private sendProgress(text: string, markStreamed = true): void {
		this.callbacks.onStatus("speaking");
		try {
			for (const content of utf8Chunks(text, HANDOFF_CHUNK_BYTES)) {
				this.peer.sendData({
					type: "session.context.append",
					channel: "speakable",
					content: [{ type: "input_text", text: content }],
				});
			}
			if (markStreamed) this.streamedProgress = true;
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
		this.streamedProgress = false;
		this.activeDelegationId = undefined;
	}

	private send(delegationId: string, channel: RealtimeHandoffChannel, content: string): void {
		for (const text of utf8Chunks(content, HANDOFF_CHUNK_BYTES)) {
			this.peer.sendData({ type: "delegation.context.append", delegation_item_id: delegationId, channel, content: [{ type: "input_text", text }] });
		}
	}
}

function secondSentenceBoundary(text: string): number | undefined {
	const ends = [...text.matchAll(/[.!?](?:["')\]]+)?(?=\s|$)/g)];
	return ends[1]?.index === undefined ? undefined : ends[1].index + ends[1][0].length;
}

function paragraphBoundary(text: string): number | undefined {
	const match = /\n\s*\n/.exec(text);
	return match?.index === undefined ? undefined : match.index + match[0].length;
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}
