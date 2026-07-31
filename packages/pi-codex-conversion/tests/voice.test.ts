import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { WebSocket } from "ws";
import { BoundedJsonlReader, parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "../src/voice/lan/draft.ts";
import { LanVoiceBrowserClients } from "../src/voice/lan/browser-clients.ts";
import { decodeLanVoiceAudioCommand } from "../src/voice/lan/protocol.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";
import {
	getPackagedCodexVoiceSystemPromptPath,
	prepareCodexVoiceSystemPrompt,
} from "../src/voice/system-prompt.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

test("voice helper parser validates protocol payloads", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 4 }), { type: "ready", version: 4 });
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
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 48_000, num_channels: 2 }));
	assert.throws(() => parseVoiceHelperEvent({ type: "data", message: { transcript: "x".repeat(64 * 1024) } }));
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }));
});

test("LAN audio command decoder rejects ambiguous browser input", () => {
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "start", mode: "conversation" }), { type: "start", mode: "conversation" });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "start", mode: "dictation" }), { type: "start", mode: "dictation" });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "mute", muted: true }), { type: "mute", muted: true });
	assert.deepEqual(decodeLanVoiceAudioCommand({
		type: "finish",
		draft: "hello",
		revision: 2,
		selectionStart: 1,
		selectionEnd: 4,
	}), {
		type: "finish",
		draft: "hello",
		revision: 2,
		selection: { start: 1, end: 4 },
	});
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "start", mode: "call" }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "mute", muted: "yes" }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "peer_state", state: "ready" }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "finish", draft: "hello", revision: 2, selectionStart: 0, selectionEnd: 6 }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "surprise" }));
});

test("LAN browser disconnect leaves the host conversation available for another device", async () => {
	let hostStarts = 0;
	let hostConversation: object | undefined;
	const received: Buffer[] = [];
	const clients = testBrowserClients({
		async ensureConversation() {
			if (!hostConversation) { hostConversation = {}; hostStarts += 1; }
		},
		onConversationAudio(pcm) { received.push(pcm); },
	});
	const first = new TestWebSocket();
	clients.connectAudio("first", first.asWebSocket());
	first.receive({ type: "start", mode: "conversation" });
	await settle();
	first.receiveBinary(Buffer.from([1, 0]));
	first.close();
	await settle();

	const second = new TestWebSocket();
	clients.connectAudio("second", second.asWebSocket());
	second.receive({ type: "start", mode: "conversation" });
	await settle();
	assert.equal(hostStarts, 1);
	assert.deepEqual(received, [Buffer.from([1, 0])]);
	assert.deepEqual(second.sent.map((value) => JSON.parse(value)), [
		{ type: "connected" },
		{ type: "active", mode: "conversation", muted: false },
	]);
	await clients.close();
});

test("LAN browser takeover shares an in-progress host conversation setup", async () => {
	const setup = Promise.withResolvers<void>();
	let hostStarts = 0;
	let sharedSetup: Promise<void> | undefined;
	const clients = testBrowserClients({
		ensureConversation() {
			if (!sharedSetup) { hostStarts += 1; sharedSetup = setup.promise; }
			return sharedSetup;
		},
	});
	const first = new TestWebSocket();
	clients.connectAudio("first", first.asWebSocket());
	first.receive({ type: "start", mode: "conversation" });
	await settle();
	const second = new TestWebSocket();
	clients.connectAudio("second", second.asWebSocket());
	second.receive({ type: "start", mode: "conversation" });
	setup.resolve();
	await settle();
	await settle();
	assert.equal(hostStarts, 1);
	assert.equal(first.readyState, WebSocket.CLOSED);
	assert.deepEqual(second.sent.map((value) => JSON.parse(value)).at(-1), { type: "active", mode: "conversation", muted: false });
	await clients.close();
});

test("LAN conversation startup reports its error without a terminal stop racing it", async () => {
	const clients = testBrowserClients({
		async ensureConversation() { throw new Error("authentication failed"); },
	});
	const socket = new TestWebSocket();
	clients.connectAudio("first", socket.asWebSocket());
	socket.receive({ type: "start", mode: "conversation" });
	await settle();
	assert.deepEqual(socket.sent.map((value) => JSON.parse(value)), [
		{ type: "connected" },
		{ type: "error", message: "authentication failed" },
	]);
	await clients.close();
});

test("voice helper JSONL parser bounds unterminated frames", () => {
	const lines: string[] = [];
	let oversized = 0;
	const reader = new BoundedJsonlReader(8, (line) => lines.push(line), () => { oversized += 1; });
	reader.push(Buffer.from("one\r\ntwo\n12345678"));
	assert.deepEqual(lines, ["one", "two"]);
	reader.push(Buffer.from("9"));
	assert.equal(oversized, 1);
	reader.push(Buffer.from("\nignored"));
	assert.deepEqual(lines, ["one", "two"]);
});

test("voice delegation suppresses backend retries without blocking a later repeat", () => {
	const turns = new RealtimeVoiceTurnTracker();
	assert.deepEqual(turns.delegated("check the load", "first"), { input: "check the load", delegationId: "first" });
	assert.equal(turns.delegated("check the load", "retry-before-settle"), undefined);
	turns.delegationSettled("first");
	assert.deepEqual(turns.delegated("check the load", "intentional-repeat"), { input: "check the load", delegationId: "intentional-repeat" });
});

test("voice prompt preparation copies the packaged template on first use", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-prompt-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	try {
		assert.deepEqual(prepareCodexVoiceSystemPrompt(promptPath), { created: true, schemaVersion: 3, currentSchemaVersion: 3, current: true });
		assert.equal(await readFile(promptPath, "utf8"), await readFile(getPackagedCodexVoiceSystemPromptPath(), "utf8"));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("voice prompt schema checks never rewrite a customized prompt", async () => {
	const directory = await mkdtemp(join(tmpdir(), "pi-voice-prompt-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	const customizedPrompt = `﻿<!-- codex-voice-prompt-version: 2 -->
## Identity and tone

Keep this customized personality.

## Interface and role

One assistant.

## Delegation

Delegate work.

## Session continuity

Preserve context.

## Backend results

Speak results.
`.replaceAll("\n", "\r\n");
	await writeFile(promptPath, customizedPrompt, { mode: 0o600 });
	try {
		assert.deepEqual(prepareCodexVoiceSystemPrompt(promptPath), { created: false, schemaVersion: 2, currentSchemaVersion: 3, current: false });
		assert.equal(await readFile(promptPath, "utf8"), customizedPrompt);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("LAN composer rejects stale writes from another browser", () => {
	const draft = new LanVoiceDraft({ publish: () => {}, sendMessage: () => {} });
	assert.equal(draft.update("phone", "first draft", 0), 1);
	assert.throws(() => draft.update("desktop", "stale draft", 0), LanVoiceDraftConflictError);
	assert.deepEqual(draft.snapshot(), { type: "draft", text: "first draft", revision: 1 });
});

test("LAN server rejects turns after its owning Pi session changes", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-lan-voice-owner-"));
	let activeSessionId = "owner";
	const sentMessages: string[] = [];
	const server = await startCodexLanVoiceServer({
		ctx: { isIdle: () => true, sessionManager: { getSessionId: () => activeSessionId } } as never,
		getConfig: () => ({}) as never,
		voice: { onInputMuteChange: () => () => {} } as never,
		resolveAuth: async () => ({}) as never,
		sendUserMessage: (text) => sentMessages.push(text),
		ownerSessionId: "owner",
		port: 0,
		certificateAgentDir: agentDir,
	});
	try {
		const url = new URL(server.urls[0]!);
		url.hostname = "127.0.0.1";
		const accepted = await requestText(new URL("/api/send", url), JSON.stringify({ clientId: "phone", text: "check the time", revision: 0 }));
		assert.equal(accepted.status, 200);
		activeSessionId = "other";
		const rejected = await requestText(new URL("/api/send", url), JSON.stringify({ clientId: "phone", text: "do not send", revision: 1 }));
		assert.equal(rejected.status, 409);
		assert.deepEqual(sentMessages, ["check the time"]);
	} finally {
		await server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
});

function testBrowserClients(overrides: {
	ensureConversation(): Promise<void>;
	onConversationAudio?(pcm: Buffer): void;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: () => {},
		onConversationMute: () => {},
		conversationMuted: () => false,
		onConversationAudio: overrides.onConversationAudio ?? (() => {}),
		onDictationAudio: () => {},
	});
}

class TestWebSocket extends EventEmitter {
	readyState: number = WebSocket.OPEN;
	readonly sent: string[] = [];

	asWebSocket(): WebSocket { return this as unknown as WebSocket; }
	send(value: string): void { this.sent.push(value); }
	receive(value: unknown): void { this.emit("message", Buffer.from(JSON.stringify(value)), false); }
	receiveBinary(value: Buffer): void { this.emit("message", value, true); }
	close(code = 1000, reason = "closed"): void {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.emit("close", code, Buffer.from(reason));
	}
	terminate(): void { this.close(1006, "terminated"); }
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}

function requestText(url: URL, body: string): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const options: RequestOptions = {
			method: "POST",
			rejectUnauthorized: false,
			headers: { "content-length": Buffer.byteLength(body), "content-type": "application/json" },
		};
		const request = httpsRequest(url, options, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
		});
		request.on("error", reject);
		request.end(body);
	});
}
