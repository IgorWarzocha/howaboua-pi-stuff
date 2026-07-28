import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BoundedJsonlReader, parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { LanVoiceDraft, LanVoiceDraftConflictError } from "../src/voice/lan/draft.ts";
import { decodeLanVoiceAudioCommand } from "../src/voice/lan/protocol.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

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
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 48_000, num_channels: 2 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "data", message: { transcript: "x".repeat(64 * 1024) } }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }), /Invalid Codex voice helper/);
});

test("LAN audio command decoder rejects ambiguous browser input", () => {
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "start", mode: "conversation" }), { type: "start", mode: "conversation" });
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
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "start" }), /Invalid LAN voice control message/);
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "finish", draft: "hello", revision: 2, selectionStart: 0, selectionEnd: 6 }), /Invalid LAN voice control message/);
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "surprise" }), /Invalid LAN voice control message/);
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

test("voice delegation suppresses backend retries without blocking a later repeat", () => {
	const turns = new RealtimeVoiceTurnTracker();
	assert.deepEqual(turns.delegated("check the load", "first"), { input: "check the load", delegationId: "first" });
	assert.equal(turns.delegated("check the load", "retry-before-settle"), undefined);
	turns.delegationSettled("first");
	assert.deepEqual(turns.delegated("check the load", "intentional-repeat"), { input: "check the load", delegationId: "intentional-repeat" });
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
		voice: {} as never,
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
