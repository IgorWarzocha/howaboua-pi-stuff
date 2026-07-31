import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BoundedJsonlReader, parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "../src/voice/lan/draft.ts";
import { LanBrowserRealtimePeer } from "../src/voice/lan/browser-peer.ts";
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
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "start", mode: "conversation", sdp: "offer" }), { type: "start", mode: "conversation", sdp: "offer" });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "start", mode: "dictation" }), { type: "start", mode: "dictation" });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "mute", muted: true }), { type: "mute", muted: true });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "peer_state", state: "ready" }), { type: "peer_state", state: "ready" });
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "peer_data", message: { type: "turn.done" } }), { type: "peer_data", message: { type: "turn.done" } });
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
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "start", mode: "conversation" }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "mute", muted: "yes" }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "finish", draft: "hello", revision: 2, selectionStart: 0, selectionEnd: 6 }));
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "surprise" }));
});

test("LAN browser peer relays WebRTC negotiation and realtime events", async () => {
	const sent: unknown[] = [];
	const events: unknown[] = [];
	const peer = new LanBrowserRealtimePeer("offer", (value) => sent.push(value));
	peer.onEvent((event) => events.push(event));
	assert.equal(await peer.start({} as never), "offer");
	peer.applyAnswer("answer");
	peer.sendData({ type: "delegation.context.append" });
	peer.setInputMuted(true);
	peer.receive({ type: "peer_state", state: "ready" });
	peer.receive({ type: "peer_data", message: { type: "turn.done" } });
	assert.deepEqual(sent, [
		{ type: "answer", sdp: "answer" },
		{ type: "peer_data", message: { type: "delegation.context.append" } },
		{ type: "mute", muted: true },
	]);
	assert.deepEqual(events, [
		{ type: "state", state: "ready" },
		{ type: "data", message: { type: "turn.done" } },
	]);
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
