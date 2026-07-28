import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import type { WebSocketLike } from "../src/providers/openai-codex/types.ts";
import { BoundedJsonlReader, parseVoiceHelperEvent, type VoiceHelperCommand, type VoiceHelperEvent } from "../src/voice/helper.ts";
import { CodexVoiceController } from "../src/voice/controller.ts";
import { CodexDictationTranscriber } from "../src/voice/dictation/transcriber.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "../src/voice/lan/draft.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";
import { LanVoiceBridgePeer } from "../src/voice/lan/bridge-peer.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { loadCodexVoiceSystemPrompt } from "../src/voice/system-prompt.ts";

test("voice helper parser validates protocol payloads", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 3 }), { type: "ready", version: 3 });
	assert.deepEqual(parseVoiceHelperEvent({
		type: "devices",
		inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
		outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
	}), {
		type: "devices",
		inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
		outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
	});
	assert.deepEqual(parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1 }), {
		type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1,
	});
	assert.deepEqual(parseVoiceHelperEvent({ type: "data", message: { type: "turn.done" } }), {
		type: "data", message: { type: "turn.done" },
	});
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: [], sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "not base64", sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 48_000, num_channels: 2 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "data", message: { transcript: "x".repeat(64 * 1024) } }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "state", state: "x".repeat(129) }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "devices", inputs: ["input-1"], outputs: [] }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }), /Invalid Codex voice helper/);
});
test("voice helper JSONL parser bounds unterminated frames", () => {
	const lines: string[] = [];
	let oversized = 0;
	const reader = new BoundedJsonlReader(8, (line) => lines.push(line), () => { oversized += 1; });
	reader.push(Buffer.from("one\r\ntw"));
	reader.push(Buffer.from("o\n12345678"));
	assert.deepEqual(lines, ["one", "two"]);
	reader.push(Buffer.from("9"));
	assert.equal(oversized, 1);
	reader.push(Buffer.from("\nignored"));
	reader.end();
	assert.equal(oversized, 1);
	assert.deepEqual(lines, ["one", "two"]);
});

test("delegated voice requests use Pi's normal user-turn pipeline", () => {
	const userMessages: unknown[] = [];
	const customMessages: unknown[] = [];
	const messages = new CodexVoiceSessionMessages({
		sendMessage: (...args: unknown[]) => { customMessages.push(args); },
		sendUserMessage: (content: unknown) => { userMessages.push(content); },
	} as never, {
		canDelegate: () => true,
		isVoiceActive: () => true,
		onDelegation: () => {},
		onWorking: () => {},
	});
	messages.setContext({ isIdle: () => true } as never);
	messages.voiceTurn({ input: "check the current time", delegationId: "delegation-1" });
	assert.deepEqual(userMessages, ["check the current time"]);
	assert.deepEqual(customMessages, []);
	assert.equal(messages.consumeDelegatedTurnStart(), true);
});

test("LAN dictation announces recognition context once per Pi session", () => {
	const customMessages: unknown[] = [];
	const controller = new CodexVoiceController({
		sendMessage: (message: unknown) => { customMessages.push(message); },
	} as never);
	const ctx = { isIdle: () => true } as never;
	controller.announceDictation(ctx);
	controller.announceDictation(ctx);
	assert.equal(customMessages.length, 1);
	assert.match(JSON.stringify(customMessages[0]), /codex_voice_mode.*dictation.*active/);
	controller.resetContextAnnouncements();
	controller.announceDictation(ctx);
	assert.equal(customMessages.length, 2);
});

test("realtime prompt always exposes the connected Pi runtime", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-prompt-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	try {
		await writeFile(promptPath, "## Interface and role\nVoice\n\n## Delegation\nRoute\n\n## Backend results\nSpeak\n");
		const prompt = loadCodexVoiceSystemPrompt(promptPath);
		assert.match(prompt, /connected Pi agent with the active session's tools and environment/i);
		assert.match(prompt, /current time or date/);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("LAN bridge routes PCM through one helper-owned V3 WebRTC peer", async () => {
	const helper = new FakeVoiceHelper();
	const output: Buffer[] = [];
	const events: unknown[] = [];
	const peer = new LanVoiceBridgePeer(
		{ path: "", write: () => {}, close: async () => {} },
		(pcm) => output.push(pcm),
		helper,
	);
	peer.onEvent((event) => events.push(event));
	const starting = peer.start({} as never);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assert.deepEqual(helper.sent, [{ type: "start_v3_bridge" }]);
	helper.emit({ type: "offer", sdp: "offer" });
	assert.equal(await starting, "offer");
	peer.applyAnswer("answer");
	peer.sendAudio(Buffer.from([1, 0, 2, 0]));
	helper.emit({ type: "pcm", audio: "AwAEAA==", sample_rate: 24_000, num_channels: 1 });
	helper.emit({ type: "data", message: { type: "session.started" } });
	assert.deepEqual(helper.sent, [
		{ type: "start_v3_bridge" },
		{ type: "apply_answer", sdp: "answer" },
		{ type: "send_pcm", audio: "AQACAA==", sample_rate: 24_000, num_channels: 1 },
	]);
	assert.deepEqual(output, [Buffer.from([3, 0, 4, 0])]);
	assert.deepEqual(events, [{ type: "data", message: { type: "session.started" } }]);
	await peer.close();
});

test("dictation transcriber commits 24 kHz PCM through the V2 transcription protocol", async () => {
	const socket = new FakeWebSocket();
	let connectedUrl = "";
	const transcriber = new CodexDictationTranscriber({ onError: () => {}, onStatus: () => {} }, async (url) => {
		connectedUrl = url;
		return socket;
	});
	await transcriber.start({
		headers: new Headers({ authorization: "Bearer test" }),
		baseUrl: "https://chatgpt.com/backend-api/codex",
		officialCodex: true,
	});
	assert.equal(connectedUrl, "wss://api.openai.com/v1/realtime?intent=transcription");
	assert.deepEqual(JSON.parse(socket.sent[0]!), {
		type: "session.update",
		session: {
			type: "transcription",
			audio: { input: {
				format: { type: "audio/pcm", rate: 24_000 },
				noise_reduction: { type: "near_field" },
				transcription: { model: "gpt-4o-mini-transcribe" },
				turn_detection: null,
			} },
		},
	});
	const pcm = Buffer.alloc(4_800, 1);
	transcriber.append(pcm);
	const append = JSON.parse(socket.sent[1]!) as { type: string; audio: string };
	assert.equal(append.type, "input_audio_buffer.append");
	assert.deepEqual(Buffer.from(append.audio, "base64"), pcm);
	const finishing = transcriber.finish();
	assert.deepEqual(JSON.parse(socket.sent[2]!), { type: "input_audio_buffer.commit" });
	socket.emit("message", { data: JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "  hello Pi  " }) });
	assert.equal(await finishing, "hello Pi");
});

test("LAN composer rejects stale writes from another browser", () => {
	const draft = new LanVoiceDraft({
		diagnostics: { path: "", write: () => {}, close: async () => {} },
		publish: () => {},
		sendMessage: () => {},
	});
	assert.equal(draft.update("phone", "first draft", 0), 1);
	assert.throws(() => draft.update("desktop", "stale draft", 0), LanVoiceDraftConflictError);
	assert.deepEqual(draft.snapshot(), { type: "draft", text: "first draft", revision: 1 });
});

test("LAN voice transfers audio ownership without restarting its realtime session", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-lan-voice-clients-"));
	let upstreamStarts = 0;
	const audio: Buffer[] = [];
	const conversation = {};
	const server = await startCodexLanVoiceServer({
		ctx: { sessionManager: { getSessionId: () => "owner" } } as never,
		getConfig: () => ({}) as never,
		voice: {
			startRealtimeWithPeer: async (_ctx: unknown, _config: unknown, peer: LanVoiceBridgePeer) => {
				upstreamStarts += 1;
				peer.sendAudio = (pcm) => audio.push(pcm);
				return conversation;
			},
			stopConversation: async () => {},
			stop: async () => {},
		} as never,
		resolveAuth: async () => ({}) as never,
		sendUserMessage: () => {},
		ownerSessionId: "owner",
		port: 0,
		certificateAgentDir: agentDir,
	});
	let first: WebSocket | undefined;
	let second: WebSocket | undefined;
	try {
		const url = new URL(server.urls[0]!);
		url.hostname = "127.0.0.1";
		first = await openAudioSocket(new URL("/api/audio?client=first", url));
		const firstActive = nextSocketJson(first);
		first.send(JSON.stringify({ type: "start" }));
		assert.deepEqual(await firstActive, { type: "active", mode: "conversation" });
		second = await openAudioSocket(new URL("/api/audio?client=second", url));
		const firstClosed = socketClosed(first);
		const secondActive = nextSocketJson(second);
		second.send(JSON.stringify({ type: "start" }));
		assert.deepEqual(await secondActive, { type: "active", mode: "conversation" });
		assert.equal((await firstClosed).code, 4001);
		second.send(Buffer.from([1, 0, 2, 0]));
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.equal(upstreamStarts, 1);
		assert.deepEqual(audio, [Buffer.from([1, 0, 2, 0])]);
	} finally {
		first?.close();
		second?.close();
		await server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
});

test("LAN voice server rejects control after its owning session changes", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-lan-voice-"));
	let activeSessionId = "owner";
	const sentMessages: string[] = [];
	const server = await startCodexLanVoiceServer({
		ctx: { sessionManager: { getSessionId: () => activeSessionId } } as never,
		getConfig: () => ({}) as never,
		voice: {
			startRealtimeWithPeer: async () => undefined,
			stop: async () => {},
		} as never,
		resolveAuth: async () => ({}) as never,
		sendUserMessage: (text) => sentMessages.push(text),
		ownerSessionId: "owner",
		port: 0,
		certificateAgentDir: agentDir,
	});
	try {
		const url = new URL(server.urls[0]!);
		url.hostname = "127.0.0.1";
		const page = await requestText(url);
		assert.equal(page.status, 200);
		assert.match(page.body, /Pi voice/);
		assert.match(page.body, /new Blob\(\[/);
		assert.match(page.body, /registerProcessor\('pi-lan-voice'/);
		const sent = await requestText(new URL("/api/send", url), {
			method: "POST",
			body: JSON.stringify({ clientId: "test-client", text: "check the time", revision: 0 }),
		});
		assert.equal(sent.status, 200);
		assert.deepEqual(sentMessages, ["check the time"]);
		activeSessionId = "other";
		const stopped = await requestText(new URL("/api/stop", url), { method: "POST" });
		assert.equal(stopped.status, 409);
		assert.match(stopped.body, /session.*no longer active/i);
		activeSessionId = "owner";
		const events = await openEventStream(new URL("/api/events?client=test-client", url));
		assert.equal(events.status, 200);
		assert.match(events.firstChunk, /event: ready/);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(events.ended(), false);
		events.close();
	} finally {
		await server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
});

function requestText(url: URL, options: { method?: string; body?: string; signal?: AbortSignal } = {}): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const body = options.body ?? "";
		const requestOptions: RequestOptions = {
			method: options.method ?? "GET",
			rejectUnauthorized: false,
			signal: options.signal,
			...(body ? { headers: { "content-length": Buffer.byteLength(body), "content-type": "application/json" } } : {}),
		};
		const request = httpsRequest(url, requestOptions, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
		});
		const abort = () => { request.socket?.destroy(); request.destroy(new Error("Request aborted")); };
		if (options.signal?.aborted) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });
		request.once("close", () => options.signal?.removeEventListener("abort", abort));
		request.on("error", reject);
		request.end(body);
	});
}

function openEventStream(url: URL): Promise<{ status: number; firstChunk: string; ended(): boolean; close(): void }> {
	return new Promise((resolve, reject) => {
		const request = httpsRequest(url, { rejectUnauthorized: false });
		request.on("response", (response) => {
			let streamEnded = false;
			response.once("end", () => { streamEnded = true; });
			response.once("data", (chunk: Buffer) => resolve({
				status: response.statusCode ?? 0,
				firstChunk: chunk.toString("utf8"),
				ended: () => streamEnded,
				close: () => { response.destroy(); request.destroy(); },
			}));
		});
		request.on("error", reject);
		request.end();
	});
}

function openAudioSocket(url: URL): Promise<WebSocket> {
	url.protocol = "wss:";
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url, { rejectUnauthorized: false });
		socket.once("error", reject);
		socket.once("message", (data) => {
			try {
				assert.deepEqual(JSON.parse(data.toString()), { type: "connected" });
				resolve(socket);
			} catch (error) { reject(error); }
		});
	});
}

function nextSocketJson(socket: WebSocket): Promise<unknown> {
	return new Promise((resolve, reject) => {
		socket.once("error", reject);
		socket.once("message", (data) => {
			try { resolve(JSON.parse(data.toString())); }
			catch (error) { reject(error); }
		});
	});
}

function socketClosed(socket: WebSocket): Promise<{ code: number; reason: string }> {
	return new Promise((resolve) => socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() })));
}

class FakeVoiceHelper {
	readonly protocolVersion = 3;
	readonly sent: VoiceHelperCommand[] = [];
	private readonly eventListeners = new Set<(event: VoiceHelperEvent) => void>();
	private readonly exitListeners = new Set<(error: Error) => void>();
	async start(): Promise<void> {}
	send(command: VoiceHelperCommand): void { this.sent.push(command); }
	onEvent(listener: (event: VoiceHelperEvent) => void): () => void {
		this.eventListeners.add(listener);
		return () => this.eventListeners.delete(listener);
	}
	onExit(listener: (error: Error) => void): () => void {
		this.exitListeners.add(listener);
		return () => this.exitListeners.delete(listener);
	}
	async close(): Promise<void> {}
	emit(event: VoiceHelperEvent): void {
		for (const listener of this.eventListeners) listener(event);
	}
}

class FakeWebSocket implements WebSocketLike {
	readonly sent: string[] = [];
	readonly listeners = new Map<string, Set<(event: unknown) => void>>();
	readyState = 1;
	send(data: string): void { this.sent.push(data); }
	close(): void { this.readyState = 3; }
	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
	}
	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}
	emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}
