import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { CodexVoiceAuth } from "../src/voice/auth.ts";
import type { RealtimeCallSetup } from "../src/voice/conversation/call-setup.ts";
import type {
	CodexRealtimePeerEvent,
	CodexRealtimeWebRtcPeer,
} from "../src/voice/conversation/peer.ts";
import {
	type CodexConversationCallbacks,
	CodexRealtimeConversation,
} from "../src/voice/conversation/session.ts";

const AUTH: CodexVoiceAuth = {
	headers: new Headers(),
	baseUrl: "https://example.test",
	officialCodex: false,
};

test("realtime forwards final speech before reporting established drops", async () => {
	const startup = createConversation("closed");
	await startup.session.start(
		AUTH,
		DEFAULT_CODEX_CONVERSION_CONFIG,
		"instructions",
	);
	assert.deepEqual(startup.failures, ["Codex realtime connection closed"]);
	assert.deepEqual(startup.drops, []);

	const active = createConversation("ready");
	await active.session.start(
		AUTH,
		DEFAULT_CODEX_CONVERSION_CONFIG,
		"instructions",
	);
	active.session.piInput("Typed request", "steer");
	active.session.streamAgentDelta(
		"First useful sentence. Second useful sentence.",
	);
	active.session.agentProgress(
		"First useful sentence. Second useful sentence.",
	);
	active.session.agentProgress("Completed reasoning summary");
	active.session.agentResult("Finished result");
	assert.deepEqual(active.peer.sentText().slice(-3), [
		[
			"session.context.append",
			"speakable",
			"First useful sentence. Second useful sentence.",
		],
		["session.context.append", "speakable", "Completed reasoning summary"],
		["session.context.append", "speakable", "Finished result"],
	]);
	active.peer.emit({
		type: "data",
		message: { type: "turn.done", turn: { role: "assistant" } },
	});
	active.session.piInput("Silent request", "steer");
	active.session.settleAgentTurn();
	assert.equal(active.statuses.at(-1), "listening");
	active.session.markEstablished();
	active.peer.emit({
		type: "error",
		message: "DataChannel is not opened",
	});
	active.peer.emit({ type: "state", state: "closed" });
	assert.deepEqual(active.failures, []);
	assert.deepEqual(active.drops, ["DataChannel is not opened"]);
	await active.session.close();
});

function createConversation(answerState: "ready" | "closed"): {
	session: CodexRealtimeConversation;
	peer: FakeRealtimePeer;
	failures: string[];
	drops: string[];
	statuses: string[];
} {
	const failures: string[] = [];
	const drops: string[] = [];
	const statuses: string[] = [];
	const peer = new FakeRealtimePeer(answerState);
	const callbacks: CodexConversationCallbacks = {
		onError: (error) => failures.push(error.message),
		onDrop: (error) => drops.push(error.message),
		onStatus: (status) => statuses.push(status),
		onTurn: () => {},
		onUserTranscript: () => {},
		onTranscriptTail: () => {},
	};
	const session = new CodexRealtimeConversation(callbacks, peer);
	(session as unknown as { callSetup: RealtimeCallSetup }).callSetup = async () => ({
		status: 201,
		answer: "answer",
	});
	return { session, peer, failures, drops, statuses };
}

class FakeRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	private readonly sent: unknown[] = [];
	private readonly answerState: "ready" | "closed";
	private readonly eventListeners = new Set<(event: CodexRealtimePeerEvent) => void>();
	private readonly exitListeners = new Set<(error: Error) => void>();

	constructor(answerState: "ready" | "closed") {
		this.answerState = answerState;
	}

	onEvent(listener: (event: CodexRealtimePeerEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}

	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}

	async start(): Promise<string> {
		return "offer";
	}

	applyAnswer(): void {
		this.emit({ type: "state", state: this.answerState });
	}

	emit(event: CodexRealtimePeerEvent): void {
		for (const listener of this.eventListeners) listener(event);
	}

	sendData(message: unknown): void {
		this.sent.push(message);
	}

	sentText(): [unknown, unknown, unknown][] {
		return this.sent.map((value) => {
			const message = value as Record<string, unknown>;
			const content = message["content"] as Array<Record<string, unknown>>;
			return [message["type"], message["channel"], content[0]?.["text"]];
		});
	}
	setInputMuted(): void {}
	async close(): Promise<void> {}
}
