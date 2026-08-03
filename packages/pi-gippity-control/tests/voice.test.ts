import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WebSocket } from "ws";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
import { buildRealtimeInitialItems } from "../src/voice/context.ts";
import { buildRealtimeCallRequest } from "../src/voice/conversation/session.ts";
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
	test("V3 setup pins delegation acknowledgement and initial context", () => {
		const initialItems = [
			{
				type: "message" as const,
				role: "developer" as const,
				content: [{ type: "input_text" as const, text: "session summary" }],
			},
		];
		expect(
			buildRealtimeCallRequest(
				"offer",
				DEFAULT_GIPPITY_CONTROL_CONFIG,
				"instructions",
				initialItems,
			).session,
		).toMatchObject({
			model: "gpt-live-1-codex",
			delegation: { type: "client", ack_filler: true },
			initial_items: initialItems,
		});
	});

	test("context sidecars serialize mixed-provider history to text", async () => {
		let sidecarContext: unknown;
		const entry = {
			type: "message",
			id: "user-message",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: {
				role: "user",
				content: [
					{ type: "text", text: "Inspect this screenshot" },
					{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
				],
				timestamp: 1,
			},
		};
		const model = {
			provider: "example",
			id: "text-model",
			maxTokens: 4_096,
		};
		const provider = {
			async *streamSimple(_model: unknown, context: unknown) {
				sidecarContext = context;
				yield {
					type: "done",
					message: { content: [{ type: "text", text: "summary" }] },
				};
			},
		};
		const ctx = {
			sessionManager: {
				getEntries: () => [entry],
				getBranch: () => [entry],
				getLeafId: () => entry.id,
				getSessionId: () => "mixed-provider-session",
			},
			modelRegistry: {
				find: () => model,
				getProvider: () => provider,
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token" }),
			},
		};

		await buildRealtimeInitialItems({
			ctx: ctx as never,
			config: {
				...DEFAULT_GIPPITY_CONTROL_CONFIG,
				voice: {
					...DEFAULT_GIPPITY_CONTROL_CONFIG.voice,
					contextModel: { provider: "example", modelId: "text-model" },
				},
			},
		});

		expect(sidecarContext).toMatchObject({
			messages: [
				{
					role: "user",
					content: [{ type: "text" }],
				},
			],
		});
		expect((sidecarContext as { tools?: unknown }).tools).toBeUndefined();
	});

	test("delegations clear prior voice chatter", () => {
		const turns = new RealtimeVoiceTurnTracker();
		turns.userFinished("terms of the laptop");
		expect(turns.assistantFinished("Do you mean temperatures?")).toEqual({
			input: "terms of the laptop",
		});
		turns.userFinished("yes, temperatures");
		expect(
			turns.delegated("check the laptop and server", "delegation-1"),
		).toEqual({
			input:
				"check the laptop and server\n\nVoice transcript: yes, temperatures",
			delegationId: "delegation-1",
		});
		expect(turns.takeTranscriptTail()).toBeUndefined();

		const delegationFirst = new RealtimeVoiceTurnTracker();
		delegationFirst.inputAdded("yes, check the laptop");
		expect(
			delegationFirst.delegated("check the laptop", "delegation-2"),
		).toBeUndefined();
		expect(delegationFirst.userFinished("yes, check the laptop")).toEqual({
			input: "yes, check the laptop",
			delegationId: "delegation-2",
		});
		expect(delegationFirst.takeTranscriptTail()).toBeUndefined();
	});

	test("delegation keeps distinct delegation and transcript context visible", () => {
		const turns = new RealtimeVoiceTurnTracker();
		turns.inputAdded("yes, temperatures");
		expect(
			turns.delegated("check the laptop and server", "delegation-1"),
		).toBeUndefined();
		expect(turns.userFinished("yes, temperatures")).toEqual({
			input:
				"check the laptop and server\n\nVoice transcript: yes, temperatures",
			delegationId: "delegation-1",
		});
	});

	test("an interrupted conversation cannot consume a later delegation", () => {
		const turns = new RealtimeVoiceTurnTracker();
		turns.inputAdded("what is the current load");
		turns.userFinished("what is the current load");
		turns.outputAdded("The load is");
		turns.inputAdded("check the logs instead");

		expect(
			turns.delegated("check the logs instead", "delegation-1"),
		).toBeUndefined();
		expect(turns.userFinished("check the logs instead")).toEqual({
			input: "check the logs instead",
			delegationId: "delegation-1",
		});
		expect(turns.assistantFinished("The load is normal")).toEqual({
			input: "what is the current load",
		});
		expect(turns.drainConversationTurns()).toEqual([]);

		const delegationBeforeFinalTranscript = new RealtimeVoiceTurnTracker();
		delegationBeforeFinalTranscript.inputAdded("what is the current load");
		expect(
			delegationBeforeFinalTranscript.delegated(
				"check the current load",
				"delegation-2",
			),
		).toBeUndefined();
		delegationBeforeFinalTranscript.outputAdded("Okay, checking");
		delegationBeforeFinalTranscript.inputAdded("check the logs instead");
		expect(
			delegationBeforeFinalTranscript.userFinished("what is the current load"),
		).toEqual({
			input:
				"check the current load\n\nVoice transcript: what is the current load",
			delegationId: "delegation-2",
		});
		expect(
			delegationBeforeFinalTranscript.userFinished("check the logs instead"),
		).toBeUndefined();
		expect(
			delegationBeforeFinalTranscript.assistantFinished("The logs are clean"),
		).toEqual({ input: "check the logs instead" });
	});

	test("presentation entries never enter Pi model queues", () => {
		const modelMessages: unknown[] = [];
		const messages = new CodexVoiceSessionMessages(
			{
				appendEntry() {},
				sendMessage(message: unknown, options: unknown) {
					modelMessages.push({ message, options });
				},
				sendUserMessage(message: unknown, options: unknown) {
					modelMessages.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		messages.modeStarted("dictation");
		messages.voiceTurn({ input: "thanks" });

		expect(modelMessages).toEqual([]);
	});

	test("delegations use Pi's plain user queues", () => {
		const sent: unknown[] = [];
		const messages = new CodexVoiceSessionMessages(
			{
				appendEntry() {},
				sendUserMessage(message: unknown, options: unknown) {
					sent.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		messages.setContext({ isIdle: () => false } as never);
		messages.voiceTurn({
			input: "do the same for the server",
			delegationId: "delegation-1",
		});

		expect(sent).toEqual([
			{
				message: "do the same for the server",
				options: { deliverAs: "steer" },
			},
		]);

		const idleSent: unknown[] = [];
		const idleMessages = new CodexVoiceSessionMessages(
			{
				appendEntry() {},
				sendUserMessage(message: unknown, options: unknown) {
					idleSent.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		idleMessages.setContext({ isIdle: () => true } as never);
		idleMessages.voiceTurn({
			input: "check the server",
			delegationId: "delegation-2",
		});
		expect(idleSent).toEqual([
			{ message: "check the server", options: undefined },
		]);
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
