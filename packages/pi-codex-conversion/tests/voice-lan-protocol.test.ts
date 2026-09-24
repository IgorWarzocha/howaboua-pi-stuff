import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
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
		decodeLanVoiceAudioCommand({
			type: "finish",
			draft: "hello",
			revision: 2,
			selectionStart: 0,
			selectionEnd: 6,
		}),
	);
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

test("LAN server admits its own pages and trusted clients only while its session is active", async () => {
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
		for (const { headers, status } of [
			{ headers: { origin: url.origin }, status: 200 },
			{ headers: { host: "phone.local:4443", origin: "https://phone.local:4443" }, status: 200 },
			{ headers: {}, status: 200 },
			{ headers: { origin: "https://unrelated.example" }, status: 403 },
			{ headers: { origin: "null" }, status: 403 },
			{ headers: { origin: `http://${url.host}` }, status: 403 },
			{ headers: { origin: `https://${url.hostname}:1` }, status: 403 },
		] satisfies { headers: Record<string, string>; status: number }[]) {
			const post = await requestText(new URL("/api/stop", url), '{"clientId":"phone"}', headers);
			const audio = await requestText(new URL("/api/audio?client=phone", url), undefined, {
				...headers,
				connection: "Upgrade",
				upgrade: "websocket",
				"sec-websocket-version": "13",
				"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
			});
			assert.deepEqual(
				{ post: post.status, audio: audio.status },
				{ post: status, audio: status === 200 ? 101 : status },
				JSON.stringify(headers),
			);
		}
		assert.equal((await requestText(new URL("/api/send", url), JSON.stringify({
			clientId: "phone", text: "do not send", revision: 0,
		}), { "content-type": "text/plain" })).status, 415);
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
		const rejectedAudio = await requestText(new URL("/api/audio?client=phone", url), undefined, {
			origin: url.origin,
			connection: "Upgrade",
			upgrade: "websocket",
			"sec-websocket-version": "13",
			"sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
		});
		assert.equal(rejectedAudio.status, 409);
		assert.deepEqual(sentMessages, ["check the time"]);
	} finally {
		await server.close();
		await rm(agentDir, { recursive: true, force: true });
	}
});

function requestText(
	url: URL,
	body?: string,
	headers: Record<string, string> = {},
): Promise<{ status: number; body: string; headers: IncomingHttpHeaders }> {
	return new Promise((resolve, reject) => {
		const options: RequestOptions = {
			method: body === undefined ? "GET" : "POST",
			rejectUnauthorized: false,
			headers: {
				...(body === undefined ? {} : { "content-length": Buffer.byteLength(body) }),
				"content-type": "application/json",
				...headers,
			},
		};
		const request = httpsRequest(url, options, (response) => {
			const chunks: Buffer[] = [];
			response.on("data", (chunk: Buffer) => chunks.push(chunk));
			response.on("end", () =>
				resolve({
					status: response.statusCode ?? 0,
					body: Buffer.concat(chunks).toString("utf8"),
					headers: response.headers,
				}),
			);
		});
		request.once("upgrade", (response, socket) => {
			socket.destroy();
			resolve({ status: response.statusCode ?? 0, body: "", headers: response.headers });
		});
		request.setTimeout(3_000, () => request.destroy(new Error("LAN request timed out")));
		request.on("error", reject);
		request.end(body);
	});
}
