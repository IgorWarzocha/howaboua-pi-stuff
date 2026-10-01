import assert from "node:assert/strict";
import test from "node:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { createEventBus, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { completedVoiceReasoningSummary } from "../src/voice/reasoning-summary.ts";
import { CodexVoiceController } from "../src/voice/controller.ts";
import type { VoiceControllerRuntime } from "../src/voice/controller-start.ts";
import { apiKey } from "./websocket-test-support.ts";
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

test("realtime joins Pi work, limits reasoning to summaries, and forwards speech before drops", async () => {
	const raw = { type: "thinking" as const, thinking: "Raw reasoning must not be spoken" };
	const signature = JSON.stringify({
		type: "reasoning",
		id: "rs_voice",
		summary: [{ type: "summary_text", text: "First summary" }, { type: "summary_text", text: "Second summary" }],
		content: [{ type: "reasoning_text", text: raw.thinking }],
		encrypted_content: "opaque/never-spoken==",
	});
	const message = { api: "openai-responses", model: "renamed-model", content: [{ ...raw, thinkingSignature: signature }] };
	for (const api of ["openai-responses", "openai-codex-responses", "azure-openai-responses"]) {
		assert.equal(completedVoiceReasoningSummary({ ...message, api }), "First summary\n\nSecond summary");
	}
	for (const thinkingSignature of [
		undefined, "{broken", "null", "[]",
		JSON.stringify({ type: "reasoning", summary: [{ type: "summary_text", text: "Missing item identity" }] }),
		JSON.stringify({ type: "message", id: "rs_voice", summary: [{ type: "summary_text", text: "Wrong provenance" }] }),
		JSON.stringify({ type: "reasoning", id: "rs_voice", summary: [] }),
		JSON.stringify({ type: "reasoning", id: "rs_voice", content: [{ type: "reasoning_text", text: raw.thinking }] }),
		JSON.stringify({ type: "reasoning", id: "rs_voice", summary: [{ type: "reasoning_text", text: raw.thinking }] }),
		JSON.stringify({ type: "reasoning", id: "rs_voice", summary: [{ type: "summary_text", text: 1 }] }),
	]) {
		assert.equal(completedVoiceReasoningSummary({
			...message, model: "gpt-6.1", content: [{ ...raw, ...(thinkingSignature !== undefined ? { thinkingSignature } : {}) }],
		}), undefined);
	}
	for (const [api, model, expected] of [
		["anthropic-messages", "claude-sonnet-4-6", "Native summary"],
		["anthropic-messages", "claude-sonnet-3-7", undefined],
		["bedrock-converse-stream", "us.anthropic.claude-opus-4-6-v1", "Native summary"],
		["bedrock-converse-stream", "deepseek-r1", undefined],
		["google-generative-ai", "gemini-3.1-pro", "Native summary"],
		["google-vertex", "gemini-3-flash", "Native summary"],
		["google-vertex", "gpt-oss-120b", undefined],
		["openai-completions", "claude-sonnet-4-6", undefined],
		["unknown-api", "gpt-6.1", undefined],
		["unknown-api", "grok-4.5", undefined],
	] as const) {
		const summary = { type: "thinking" as const, thinking: "Native summary" };
		const message = { api, model, content: [summary] };
		assert.equal(completedVoiceReasoningSummary(message), expected);
		if (expected !== undefined) {
			assert.equal(completedVoiceReasoningSummary({
				...message, content: [{ ...summary, redacted: true }],
			}), undefined);
		}
	}
	assert.equal(completedVoiceReasoningSummary({
		api: "anthropic-messages", model: "claude-sonnet-4-6", responseModel: "claude-sonnet-3-7",
		content: [raw],
	}), undefined, "the actual response model determines native summarized thinking");
	// Readiness, not the startup snapshot, determines whether this call joins
	// an existing Pi turn. Exercise the controller without live auth or audio.
	for (const [initialIdle, readyIdle] of [[false, false], [false, true], [true, false], [true, true]]) {
		let idle = initialIdle;
		const controller = new CodexVoiceController({ events: createEventBus(), appendEntry() {}, sendMessage() {} } as unknown as ExtensionAPI);
		controller.prepareRealtimePrompt = () => "instructions";
		const peer = new FakeRealtimePeer("ready");
		peer.start = async () => {
			const { state } = (controller as unknown as { runtime: VoiceControllerRuntime }).runtime;
			assert.ok(state.type === "connecting" && state.mode === "realtime" && state.phase === "starting");
			(state.session as unknown as { callSetup: RealtimeCallSetup }).callSetup = async () => {
				idle = readyIdle;
				if (!idle) controller.agentStarted();
				return { status: 201, answer: "answer" };
			};
			return "offer";
		};
		const config = structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
		config.voice.contextModel = undefined;
		const session = await controller.startRealtimeWithPeerPlan({
			isIdle: () => idle,
			modelRegistry: { getProviderAuth: async () => ({ auth: { apiKey, baseUrl: AUTH.baseUrl } }) },
			sessionManager: { getSessionId: () => "voice-routing" },
			ui: { setStatus() {}, notify() {}, theme: { fg: (_color: string, value: string) => value } },
		} as unknown as ExtensionContext, config, { createPeer: () => peer });
		assert.ok(session);
		const completed = (text: string, stopReason: AssistantMessage["stopReason"]): AssistantMessage => ({
			role: "assistant", api: "openai-responses", provider: "openai", model: "test",
			content: [{ type: "text", text }], stopReason, timestamp: 0,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		});
		controller.finishAgentMessage(completed("Ongoing progress", "toolUse"), false);
		controller.finishAgentMessage(completed("Ongoing result", "stop"), false);
		assert.deepEqual(peer.sentText(), readyIdle ? [] : [
			["session.context.append", "speakable", "Ongoing progress"],
			["session.context.append", "speakable", "Ongoing result"],
		]);
		controller.settleTurn();
		const beforeNext = peer.sentText().length;
		for (const stopReason of ["aborted", "error"] as const) {
			controller.agentStarted();
			session.streamAgentDelta("Progress before termination.");
			session.resumeAgentWork();
			controller.finishAgentMessage(completed("Progress before termination.", "toolUse"), false);
			controller.finishAgentMessage(completed(stopReason, stopReason), false);
			controller.settleTurn();
			controller.finishAgentMessage(completed("Late final", "stop"), false);
		}
		assert.deepEqual(peer.sentText().slice(beforeNext), [
			["session.context.append", "speakable", "Progress before termination."],
			["session.context.append", "speakable", "aborted"],
			["session.context.append", "speakable", "Progress before termination."],
			["session.context.append", "speakable", "error"],
		]);
		await controller.stop();
		controller.agentStarted();
		controller.finishAgentMessage(completed("After stop", "stop"), false);
		assert.equal(peer.sentText().length, beforeNext + 4);
	}
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
	active.peer.transcript("user", "First request", true);
	assert.deepEqual(active.peer.playbackControls, [], "quiet turns accept audio before captions");
	active.peer.transcript("assistant", "Old answer");
	active.peer.transcript("user", "Actually");
	active.peer.transcript("user", "change that");
	assert.deepEqual(active.peer.playbackControls, [true], "one flush per spoken interruption");
	active.peer.transcript("assistant", "old interleaved fragment");
	active.peer.transcript("user", "Actually change that", true);
	active.peer.transcript("assistant", "old late fragment");
	assert.deepEqual(active.peer.playbackControls, [true], "old captions cannot reopen playback");
	active.peer.transcript("assistant", "Old answer", true);
	assert.deepEqual(active.peer.playbackControls, [true], "completion alone cannot release suppression");
	active.peer.transcript("assistant", "New answer");
	assert.deepEqual(active.peer.playbackControls, [true, false]);
	active.peer.transcript("assistant", "New answer", true);
	active.peer.emit({ type: "playback_activity" });
	active.peer.transcript("user", "Interrupt buffered audio", true);
	assert.deepEqual(active.peer.playbackControls, [true, false, true], "done-only input retires buffered audio");
	active.peer.transcript("assistant", "Next answer");
	active.peer.transcript("assistant", "Next answer", true);
	assert.deepEqual(active.peer.playbackControls, [true, false, true, false]);
	const beforeTyping = [...active.peer.playbackControls];
	active.session.piInput("Typed request", "steer");
	assert.deepEqual(active.peer.playbackControls, beforeTyping, "typing keeps the existing speech policy");
	active.session.streamAgentDelta(
		"First useful sentence. Second useful sentence.",
	);
	active.session.resumeAgentWork();
	assert.deepEqual(active.peer.sentText().at(-1), [
		"session.context.append",
		"speakable",
		"First useful sentence. Second useful sentence.",
	]);
	const beforeTool = active.peer.sentText().length;
	active.session.resumeAgentWork();
	active.session.agentProgress(
		"First useful sentence. Second useful sentence.",
	);
	assert.equal(active.peer.sentText().length, beforeTool);
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
	active.peer.emit({
		type: "data",
		message: { type: "input_transcript.added", item: { text: "Check" } },
	});
	let inputFinished = false;
	const input = active.session.waitForInput(new AbortController().signal)
		.then(() => { inputFinished = true; });
	await Promise.resolve();
	assert.equal(inputFinished, false);
	active.peer.emit({
		type: "data",
		message: { type: "turn.done", turn: { role: "user", transcript: "Check the server" } },
	});
	await Promise.resolve();
	assert.equal(inputFinished, false, "keep the call until the utterance is answered or delegated");
	active.peer.emit({
		type: "data",
		message: {
			type: "delegation.created",
			item: {
				type: "delegation", target: "client", id: "before-refresh",
				content: [{ type: "input_text", text: "Check the server" }],
			},
		},
	});
	await input;
	assert.equal(inputFinished, true);
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
	readonly playbackControls: boolean[] = [];
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
	setSpeakerSuppressed(suppressed: boolean): void {
		this.playbackControls.push(suppressed);
	}
	transcript(role: "user" | "assistant", text: string, done = false): void {
		this.emit({
			type: "data",
			message: done
				? { type: "turn.done", turn: { role, transcript: text } }
				: { type: role === "user" ? "input_transcript.added" : "output_transcript.added", item: { text } },
		});
	}
	async close(): Promise<void> {}
}
