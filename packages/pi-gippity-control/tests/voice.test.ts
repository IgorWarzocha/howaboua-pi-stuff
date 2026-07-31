import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WebSocket } from "ws";
import { LanVoiceBrowserClients } from "../src/voice/lan/browser-clients.ts";
import { decodeLanVoiceAudioCommand } from "../src/voice/lan/protocol.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import {
	getPackagedCodexVoiceSystemPromptPath,
	prepareCodexVoiceSystemPrompt,
} from "../src/voice/system-prompt.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

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

describe("realtime session routing", () => {
	test("delegations carry conversation since the previous handoff", () => {
		const turns = new RealtimeVoiceTurnTracker();
		turns.userFinished("terms of the laptop");
		expect(turns.assistantFinished("Do you mean temperatures?")).toEqual({
			input: "terms of the laptop",
		});
		turns.userFinished("yes, temperatures");
		expect(
			turns.delegated("check the laptop and server", "delegation-1"),
		).toEqual({
			input: "check the laptop and server",
			delegationId: "delegation-1",
			transcriptDelta:
				"user: terms of the laptop\nassistant: Do you mean temperatures?\nuser: yes, temperatures",
		});
	});

	test("presentation entries never enter Pi model queues", () => {
		const entries: Array<{ customType: string; data: unknown }> = [];
		const modelMessages: unknown[] = [];
		const messages = new CodexVoiceSessionMessages(
			{
				appendEntry(customType: string, data: unknown) {
					entries.push({ customType, data });
				},
				sendMessage(message: unknown, options: unknown) {
					modelMessages.push({ message, options });
				},
				sendUserMessage(message: unknown, options: unknown) {
					modelMessages.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		messages.setContext({ isIdle: () => false } as never);
		messages.modeStarted("dictation");
		messages.voiceTurn({ input: "thanks" });

		expect(entries).toEqual([
			{
				customType: "gippity-voice-mode",
				data: { mode: "dictation", state: "started" },
			},
			{
				customType: "gippity-realtime-voice",
				data: { input: "thanks", route: "conversation" },
			},
		]);
		expect(modelMessages).toEqual([]);
	});

	test("an active delegation is the sole Pi steer and carries transcript context", () => {
		const userMessages: Array<{ input: unknown; options: unknown }> = [];
		const messages = new CodexVoiceSessionMessages(
			{
				appendEntry() {},
				sendUserMessage(input: unknown, options: unknown) {
					userMessages.push({ input, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		messages.setContext({ isIdle: () => false } as never);
		messages.voiceTurn({
			input: "do the same for the server",
			delegationId: "delegation-1",
			transcriptDelta:
				"user: temperatures, not terms\nassistant: checking the temperatures",
		});
		expect(userMessages).toEqual([
			{
				input: "do the same for the server",
				options: { deliverAs: "steer" },
			},
		]);

		const visibleUserMessage = {
			role: "user" as const,
			content: [{ type: "text" as const, text: "do the same for the server" }],
			timestamp: 42,
		};
		messages.bindDelegatedUserMessage(visibleUserMessage);
		const providerMessages = messages.applyDelegationContext([
			{
				role: "custom",
				customType: "gippity-realtime-voice",
				content: "legacy display card",
				display: true,
				details: {},
				timestamp: 41,
			},
			visibleUserMessage,
		]);
		expect(providerMessages).toHaveLength(1);
		const [providerMessage] = providerMessages;
		expect(visibleUserMessage.content[0]?.text).toBe(
			"do the same for the server",
		);
		expect(providerMessage?.content[0]?.text).toBe(`<realtime_delegation>
  <input>do the same for the server</input>
  <transcript_delta>user: temperatures, not terms
assistant: checking the temperatures</transcript_delta>
  <routing>realtime voice is active; input may contain recognition errors; keep spoken updates concise</routing>
</realtime_delegation>`);
	});
});

function voiceMessageCallbacks() {
	return {
		canDelegate: () => true,
		onDelegation: () => {},
		onWorking: () => {},
	};
}

describe("LAN conversation setup", () => {
	test("rejects browser-owned peer messages", () => {
		expect(() =>
			decodeLanVoiceAudioCommand({ type: "peer_state", state: "ready" }),
		).toThrow();
	});

	test("disconnect leaves the host conversation available for another device", async () => {
		let hostStarts = 0;
		let hostConversation: object | undefined;
		const clients = testBrowserClients({
			async ensureConversation() {
				if (!hostConversation) {
					hostConversation = {};
					hostStarts += 1;
				}
			},
		});
		const first = new TestWebSocket();
		clients.connectAudio("first", first.asWebSocket());
		first.receive({ type: "start", mode: "conversation" });
		await settle();
		first.close();
		await settle();
		const second = new TestWebSocket();
		clients.connectAudio("second", second.asWebSocket());
		second.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(hostStarts).toBe(1);
		expect(second.sent.map((value) => JSON.parse(value)).at(-1)).toEqual({
			type: "active",
			mode: "conversation",
			muted: false,
		});
		await clients.close();
	});

	test("takeover shares the pending host conversation setup", async () => {
		const setup = Promise.withResolvers<void>();
		let hostStarts = 0;
		let sharedSetup: Promise<void> | undefined;
		const clients = testBrowserClients({
			ensureConversation() {
				if (!sharedSetup) {
					hostStarts += 1;
					sharedSetup = setup.promise;
				}
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
		expect(hostStarts).toBe(1);
		expect(first.readyState).toBe(WebSocket.CLOSED);
		expect(second.sent.map((value) => JSON.parse(value)).at(-1)).toEqual({
			type: "active",
			mode: "conversation",
			muted: false,
		});
		await clients.close();
	});

	test("reports startup errors without a terminal stop racing them", async () => {
		const clients = testBrowserClients({
			async ensureConversation() {
				throw new Error("authentication failed");
			},
		});
		const socket = new TestWebSocket();
		clients.connectAudio("first", socket.asWebSocket());
		socket.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(socket.sent.map((value) => JSON.parse(value))).toEqual([
			{ type: "connected" },
			{ type: "error", message: "authentication failed" },
		]);
		await clients.close();
	});
});

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "gippity-voice-prompt-"));
	directories.push(directory);
	return directory;
}

function testBrowserClients(overrides: {
	ensureConversation(): Promise<void>;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: () => {},
		onConversationMute: () => {},
		conversationMuted: () => false,
		onConversationAudio: () => {},
		onDictationAudio: () => {},
	});
}

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
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
