import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";
import { LanVoiceBrowserClients } from "../src/voice/lan/browser-clients.ts";
import { LanBrowserRealtimePeer } from "../src/voice/lan/browser-peer.ts";
import {
	getPackagedCodexVoiceSystemPromptPath,
	prepareCodexVoiceSystemPrompt,
} from "../src/voice/system-prompt.ts";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("realtime prompt persistence", () => {
	test("first use copies the packaged schema", async () => {
		const directory = await temporaryDirectory();
		const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
		expect(prepareCodexVoiceSystemPrompt(promptPath)).toEqual({
			created: true,
			schemaVersion: 3,
			currentSchemaVersion: 3,
			current: true,
		});
		expect(await readFile(promptPath, "utf8")).toBe(
			await readFile(getPackagedCodexVoiceSystemPromptPath(), "utf8"),
		);
	});

	test("schema checks preserve customized prompts byte-for-byte", async () => {
		const directory = await temporaryDirectory();
		const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
		const customized =
			"<!-- codex-voice-prompt-version: 2 -->\r\n## Identity and tone\r\n\r\nKeep my voice.\r\n";
		await writeFile(promptPath, customized, { mode: 0o600 });
		expect(prepareCodexVoiceSystemPrompt(promptPath)).toEqual({
			created: false,
			schemaVersion: 2,
			currentSchemaVersion: 3,
			current: false,
		});
		expect(await readFile(promptPath, "utf8")).toBe(customized);
	});
});

describe("LAN conversation setup", () => {
	test("disconnect cancels the pending setup", async () => {
		const setup = Promise.withResolvers<void>();
		const started = Promise.withResolvers<LanBrowserRealtimePeer>();
		const cancelled: LanBrowserRealtimePeer[] = [];
		const clients = testBrowserClients({
			startConversation(peer) {
				started.resolve(peer);
				return setup.promise;
			},
			cancelConversationStart(peer) {
				cancelled.push(peer);
				setup.reject(new Error("cancelled"));
			},
		});
		const socket = new TestWebSocket();
		clients.connectAudio("first", socket.asWebSocket());
		socket.receive({ type: "start", mode: "conversation", sdp: "offer" });
		const peer = await started.promise;
		socket.close();
		expect(cancelled).toEqual([peer]);
		await clients.close();
	});

	test("takeover cancels the pending setup", async () => {
		const firstSetup = Promise.withResolvers<void>();
		const firstStarted = Promise.withResolvers<LanBrowserRealtimePeer>();
		const secondStarted = Promise.withResolvers<LanBrowserRealtimePeer>();
		const cancelled: LanBrowserRealtimePeer[] = [];
		let starts = 0;
		const clients = testBrowserClients({
			startConversation(peer) {
				starts += 1;
				if (starts === 1) {
					firstStarted.resolve(peer);
					return firstSetup.promise;
				}
				secondStarted.resolve(peer);
				return Promise.resolve();
			},
			cancelConversationStart(peer) {
				cancelled.push(peer);
				firstSetup.reject(new Error("cancelled"));
			},
		});
		const first = new TestWebSocket();
		clients.connectAudio("first", first.asWebSocket());
		first.receive({
			type: "start",
			mode: "conversation",
			sdp: "first-offer",
		});
		const firstPeer = await firstStarted.promise;
		const second = new TestWebSocket();
		clients.connectAudio("second", second.asWebSocket());
		second.receive({
			type: "start",
			mode: "conversation",
			sdp: "second-offer",
		});
		expect(cancelled).toEqual([firstPeer]);
		await secondStarted.promise;
		await clients.close();
	});
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "gippity-voice-prompt-"));
	directories.push(directory);
	return directory;
}

function testBrowserClients(overrides: {
	startConversation(peer: LanBrowserRealtimePeer): Promise<void>;
	cancelConversationStart(peer: LanBrowserRealtimePeer): void;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		stopConversation: async () => {},
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: () => {},
		onConversationMute: () => {},
		onDictationAudio: () => {},
	});
}

class TestWebSocket extends EventEmitter {
	readyState: number = WebSocket.OPEN;
	readonly sent: string[] = [];

	asWebSocket(): WebSocket {
		return this as unknown as WebSocket;
	}

	send(value: string): void {
		this.sent.push(value);
	}

	receive(value: unknown): void {
		this.emit("message", Buffer.from(JSON.stringify(value)), false);
	}

	close(code = 1000, reason = "closed"): void {
		if (this.readyState === WebSocket.CLOSED) return;
		this.readyState = WebSocket.CLOSED;
		this.emit("close", code, Buffer.from(reason));
	}

	terminate(): void {
		this.close(1006, "terminated");
	}
}
