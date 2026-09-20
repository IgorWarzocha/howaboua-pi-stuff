import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
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
		DEFAULT_GIPPITY_CONTROL_CONFIG,
		"instructions",
	);
	assert.deepEqual(startup.failures, ["Codex realtime connection closed"]);
	assert.deepEqual(startup.drops, []);

	const active = createConversation("ready");
	await active.session.start(
		AUTH,
		DEFAULT_GIPPITY_CONTROL_CONFIG,
		"instructions",
	);
	active.peer.transcript("assistant", "Old answer");
	active.peer.transcript("user", "Actually");
	active.peer.transcript("assistant", "old interleaved fragment");
	active.peer.transcript("user", "Actually", true);
	active.peer.transcript("assistant", "old late fragment");
	active.peer.transcript("assistant", "Old answer", true);
	assert.deepEqual(active.peer.playbackControls, [true]);
	active.peer.transcript("assistant", "New answer");
	assert.deepEqual(active.peer.playbackControls, [true, false]);
	active.session.activateDelegation("delegation-1");
	const final = "Finished result. Everything checked. Ready to continue.";
	active.session.streamAgentDelta(final);
	active.session.agentResult(final);
	assert.deepEqual(active.peer.sentText(), [
		[
			"session.context.append",
			"speakable",
			"Finished result. Everything checked.",
		],
		["delegation.context.append", "speakable", "Ready to continue."],
	]);
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
} {
	const failures: string[] = [];
	const drops: string[] = [];
	const peer = new FakeRealtimePeer(answerState);
	const callbacks: CodexConversationCallbacks = {
		onError: (error) => failures.push(error.message),
		onDrop: (error) => drops.push(error.message),
		onStatus: () => {},
		onTurn: () => {},
		onUserTranscript: () => {},
		onTranscriptTail: () => {},
	};
	const session = new CodexRealtimeConversation(callbacks, peer);
	(session as unknown as { callSetup: RealtimeCallSetup }).callSetup =
		async () => ({
			status: 201,
			answer: "answer",
		});
	return { session, peer, failures, drops };
}

class FakeRealtimePeer implements CodexRealtimeWebRtcPeer {
	readonly kind = "webrtc" as const;
	readonly playbackControls: boolean[] = [];
	private readonly sent: unknown[] = [];
	private readonly answerState: "ready" | "closed";
	private readonly eventListeners = new Set<
		(event: CodexRealtimePeerEvent) => void
	>();
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
	setSpeakerSuppressed(suppressed: boolean): void {
		this.playbackControls.push(suppressed);
	}
	transcript(role: "user" | "assistant", text: string, done = false): void {
		this.emit({
			type: "data",
			message: done
				? { type: "turn.done", turn: { role, transcript: text } }
				: {
						type:
							role === "user"
								? "input_transcript.added"
								: "output_transcript.added",
						item: { text },
					},
		});
	}
	async close(): Promise<void> {}
}
