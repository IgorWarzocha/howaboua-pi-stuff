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
import { completedVoiceReasoningSummary } from "../src/voice/reasoning-summary.ts";

const AUTH: CodexVoiceAuth = {
	headers: new Headers(),
	baseUrl: "https://example.test",
	officialCodex: false,
};

test("realtime limits reasoning to summaries and forwards final speech before established drops", async () => {
	const raw = {
		type: "thinking" as const,
		thinking: "Raw reasoning must not be spoken",
	};
	const signature = JSON.stringify({
		type: "reasoning",
		id: "rs_voice",
		summary: [
			{ type: "summary_text", text: "First summary" },
			{ type: "summary_text", text: "Second summary" },
		],
		content: [{ type: "reasoning_text", text: raw.thinking }],
		encrypted_content: "opaque/never-spoken==",
	});
	const message = {
		api: "openai-responses",
		model: "renamed-model",
		content: [{ ...raw, thinkingSignature: signature }],
	};
	for (const api of [
		"openai-responses",
		"openai-codex-responses",
		"azure-openai-responses",
	]) {
		assert.equal(
			completedVoiceReasoningSummary({ ...message, api }),
			"First summary\n\nSecond summary",
		);
	}
	for (const thinkingSignature of [
		undefined,
		"{broken",
		"null",
		"[]",
		JSON.stringify({
			type: "reasoning",
			summary: [{ type: "summary_text", text: "Missing item identity" }],
		}),
		JSON.stringify({
			type: "message",
			id: "rs_voice",
			summary: [{ type: "summary_text", text: "Wrong provenance" }],
		}),
		JSON.stringify({ type: "reasoning", id: "rs_voice", summary: [] }),
		JSON.stringify({
			type: "reasoning",
			id: "rs_voice",
			content: [{ type: "reasoning_text", text: raw.thinking }],
		}),
		JSON.stringify({
			type: "reasoning",
			id: "rs_voice",
			summary: [{ type: "reasoning_text", text: raw.thinking }],
		}),
		JSON.stringify({
			type: "reasoning",
			id: "rs_voice",
			summary: [{ type: "summary_text", text: 1 }],
		}),
	]) {
		assert.equal(
			completedVoiceReasoningSummary({
				...message,
				model: "gpt-6.1",
				content: [
					{
						...raw,
						...(thinkingSignature !== undefined ? { thinkingSignature } : {}),
					},
				],
			}),
			undefined,
		);
	}
	for (const [api, model, expected] of [
		["anthropic-messages", "claude-sonnet-4-6", "Native summary"],
		["anthropic-messages", "claude-sonnet-3-7", undefined],
		[
			"bedrock-converse-stream",
			"us.anthropic.claude-opus-4-6-v1",
			"Native summary",
		],
		["bedrock-converse-stream", "deepseek-r1", undefined],
		["google-generative-ai", "gemini-3.1-pro", "Native summary"],
		["google-vertex", "gemini-3-flash", "Native summary"],
		["google-vertex", "gpt-oss-120b", undefined],
		["openai-completions", "claude-sonnet-4-6", undefined],
		["unknown-api", "gpt-6.1", undefined],
		["unknown-api", "grok-4.5", undefined],
	] as const) {
		const summary = { type: "thinking" as const, thinking: "Native summary" };
		const message = {
			api,
			model,
			content: [summary],
		};
		assert.equal(completedVoiceReasoningSummary(message), expected);
		if (expected !== undefined) {
			assert.equal(
				completedVoiceReasoningSummary({
					...message,
					content: [{ ...summary, redacted: true }],
				}),
				undefined,
			);
		}
	}
	assert.equal(
		completedVoiceReasoningSummary({
			api: "anthropic-messages",
			model: "claude-sonnet-4-6",
			responseModel: "claude-sonnet-3-7",
			content: [raw],
		}),
		undefined,
		"the actual response model determines native summarized thinking",
	);
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
