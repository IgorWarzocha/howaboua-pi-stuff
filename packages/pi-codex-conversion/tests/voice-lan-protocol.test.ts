import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
	LanVoiceDraft,
	LanVoiceDraftConflictError,
} from "../src/voice/lan/draft.ts";
import { decodeLanVoiceAudioCommand } from "../src/voice/lan/protocol.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";

test("LAN audio command decoder rejects ambiguous browser input", () => {
	assert.deepEqual(
		decodeLanVoiceAudioCommand({ type: "start", mode: "conversation" }),
		{ type: "start", mode: "conversation" },
	);
	assert.deepEqual(
		decodeLanVoiceAudioCommand({ type: "start", mode: "dictation" }),
		{ type: "start", mode: "dictation" },
	);
	assert.deepEqual(decodeLanVoiceAudioCommand({ type: "mute", muted: true }), {
		type: "mute",
		muted: true,
	});
	assert.deepEqual(
		decodeLanVoiceAudioCommand({
			type: "finish",
			draft: "hello",
			revision: 2,
			selectionStart: 1,
			selectionEnd: 4,
		}),
		{
			type: "finish",
			draft: "hello",
			revision: 2,
			selection: { start: 1, end: 4 },
		},
	);
	assert.throws(() =>
		decodeLanVoiceAudioCommand({ type: "start", mode: "call" }),
	);
	assert.throws(() =>
		decodeLanVoiceAudioCommand({ type: "mute", muted: "yes" }),
	);
	assert.throws(() =>
		decodeLanVoiceAudioCommand({ type: "peer_state", state: "ready" }),
	);
	assert.throws(() =>
		decodeLanVoiceAudioCommand({
			type: "finish",
			draft: "hello",
			revision: 2,
			selectionStart: 0,
			selectionEnd: 6,
		}),
	);
	assert.throws(() => decodeLanVoiceAudioCommand({ type: "surprise" }));
});

test("LAN composer rejects stale writes from another browser", () => {
	const draft = new LanVoiceDraft({ publish: () => {}, sendMessage: () => {} });
	assert.equal(draft.update("phone", "first draft", 0), 1);
	assert.throws(
		() => draft.update("desktop", "stale draft", 0),
		LanVoiceDraftConflictError,
	);
	assert.deepEqual(draft.snapshot(), {
		type: "draft",
		text: "first draft",
		revision: 1,
	});
});

test("LAN server rejects turns after its owning Pi session changes", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-lan-voice-owner-"));
	let activeSessionId = "owner";
	const sentMessages: string[] = [];
	const server = await startCodexLanVoiceServer({
		ctx: {
			isIdle: () => true,
			sessionManager: { getSessionId: () => activeSessionId },
		} as never,
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
		const accepted = await requestText(
			new URL("/api/send", url),
			JSON.stringify({
				clientId: "phone",
				text: "check the time",
				revision: 0,
			}),
		);
		assert.equal(accepted.status, 200);
		activeSessionId = "other";
		const rejected = await requestText(
			new URL("/api/send", url),
			JSON.stringify({ clientId: "phone", text: "do not send", revision: 1 }),
		);
		assert.equal(rejected.status, 409);
		assert.deepEqual(sentMessages, ["check the time"]);
	} finally {
		await server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
});

function requestText(
	url: URL,
	body: string,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const options: RequestOptions = {
			method: "POST",
			rejectUnauthorized: false,
			headers: {
				"content-length": Buffer.byteLength(body),
				"content-type": "application/json",
			},
		};
		const request = httpsRequest(url, options, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () =>
				resolve({
					status: response.statusCode ?? 0,
					body: Buffer.concat(chunks).toString("utf8"),
				}),
			);
		});
		request.on("error", reject);
		request.end(body);
	});
}
