import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { BoundedJsonlReader, parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { CodexRealtimeConversation } from "../src/voice/conversation/session.ts";
import { LanVoiceBrowserPeer } from "../src/voice/lan/browser-peer.ts";
import { startCodexLanVoiceServer } from "../src/voice/lan/server.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { loadCodexVoiceSystemPrompt } from "../src/voice/system-prompt.ts";

test("voice helper parser validates protocol payloads", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 2 }), { type: "ready", version: 2 });
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

test("LAN browser peer preserves realtime data in both directions", async () => {
	const commands: unknown[] = [];
	const events: unknown[] = [];
	const peer = new LanVoiceBrowserPeer("offer-sdp", (command) => commands.push(command));
	peer.onEvent((event) => events.push(event));
	assert.equal(await peer.start({} as never), "offer-sdp");
	peer.applyAnswer("answer-sdp");
	assert.equal(peer.takeAnswer(), "answer-sdp");
	peer.receiveData({ type: "turn.done" });
	peer.receiveState("connected");
	peer.sendData({ type: "delegation.context.append" });
	assert.deepEqual(events, [
		{ type: "data", message: { type: "turn.done" } },
		{ type: "state", state: "connected" },
	]);
	assert.deepEqual(commands, [{ type: "send_data", message: { type: "delegation.context.append" } }]);
	await peer.close();
	assert.deepEqual(commands.at(-1), { type: "stop" });
});

test("browser realtime uses its peer instead of configured host audio devices", async () => {
	let requestBody = "";
	const setupServer = createHttpServer((request, response) => {
		request.on("data", (chunk: Buffer) => { requestBody += chunk.toString("utf8"); });
		request.on("end", () => { response.writeHead(201); response.end("answer-sdp"); });
	});
	await new Promise<void>((resolve, reject) => {
		setupServer.once("error", reject);
		setupServer.listen(0, "127.0.0.1", resolve);
	});
	const address = setupServer.address() as AddressInfo;
	const commands: unknown[] = [];
	const peer = new LanVoiceBrowserPeer("browser-offer", (command) => commands.push(command));
	const conversation = new CodexRealtimeConversation({
		onError: (error) => { throw error; },
		onStatus: () => {},
		onTurn: () => {},
	}, peer);
	try {
		await conversation.start({
			headers: new Headers(),
			baseUrl: `http://127.0.0.1:${address.port}`,
			officialCodex: false,
			env: { NO_PROXY: "127.0.0.1", no_proxy: "127.0.0.1" },
		}, {
			voice: {
				inputDevice: "alsa:unavailable-host-input",
				outputDevice: "alsa:unavailable-host-output",
				v3Voice: "maple",
			},
		} as never, "instructions");
		assert.match(requestBody, /browser-offer/);
		assert.equal(peer.takeAnswer(), "answer-sdp");
		assert.equal(commands.some((command) => (command as { type?: string }).type === "send_data"), false);
	} finally {
		await conversation.close();
		await new Promise<void>((resolve) => setupServer.close(() => resolve()));
	}
});

test("LAN voice server rejects control after its owning session changes", async () => {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-lan-voice-"));
	let activeSessionId = "owner";
	let stoppedCalls = 0;
	const callStarted = Promise.withResolvers<void>();
	const callStopped = Promise.withResolvers<void>();
	const releaseCall = Promise.withResolvers<void>();
	const server = await startCodexLanVoiceServer({
		ctx: { sessionManager: { getSessionId: () => activeSessionId } } as never,
		getConfig: () => ({}) as never,
		voice: {
			startRealtimeWithPeer: async () => { callStarted.resolve(); await releaseCall.promise; return undefined; },
			stop: async () => { stoppedCalls += 1; callStopped.resolve(); },
		} as never,
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
		activeSessionId = "other";
		const stopped = await requestText(new URL("/api/stop", url), { method: "POST" });
		assert.equal(stopped.status, 409);
		assert.match(stopped.body, /session.*no longer active/i);
		activeSessionId = "owner";
		const events = await openEventStream(new URL("/api/events", url));
		assert.equal(events.status, 200);
		assert.match(events.firstChunk, /event: ready/);
		await new Promise((resolve) => setTimeout(resolve, 30));
		assert.equal(events.ended(), false);
		if (!process.versions["bun"]) {
			const callAbort = new AbortController();
			const call = requestText(new URL("/api/call", url), {
				method: "POST",
				body: JSON.stringify({ offer: "browser-offer" }),
				signal: callAbort.signal,
			}).catch(() => undefined);
			await callStarted.promise;
			callAbort.abort();
			const stoppedBeforeSetupCompleted = await Promise.race([
				callStopped.promise.then(() => true),
				new Promise<false>((resolve) => setTimeout(() => resolve(false), 500)),
			]);
			releaseCall.resolve();
			await call;
			assert.equal(stoppedBeforeSetupCompleted, true);
			assert.equal(stoppedCalls, 1);
		}
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
