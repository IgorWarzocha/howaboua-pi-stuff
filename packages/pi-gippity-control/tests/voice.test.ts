import { afterEach, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { WebSocket } from "ws";
import { DEFAULT_GIPPITY_CONTROL_CONFIG } from "../src/config.ts";
import { buildRealtimeInitialItems } from "../src/voice/context.ts";
import {
	RealtimeDelegationHandoff,
	realtimeHandoffChannel,
} from "../src/voice/conversation/handoff.ts";
import type { CodexRealtimePeer } from "../src/voice/conversation/peer.ts";
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
	test("assistant message boundaries route clean realtime handoffs", () => {
		const sent: unknown[] = [];
		const handoff = new RealtimeDelegationHandoff(
			{
				sendData: (message: unknown) => sent.push(message),
			} as unknown as CodexRealtimePeer,
			{
				isActive: () => true,
				onFailure: (error) => {
					throw error;
				},
				onSettled: () => undefined,
				onStatus: () => undefined,
			},
		);
		handoff.activate("delegation-1");
		handoff.stream("Checking cache");
		handoff.finishMessage(realtimeHandoffChannel("toolUse"));
		handoff.stream("Finished");
		handoff.finishMessage(realtimeHandoffChannel("stop"));
		expect(sent).toEqual([
			{
				type: "delegation.context.append",
				delegation_item_id: "delegation-1",
				channel: "commentary",
				content: [{ type: "input_text", text: "Checking cache" }],
			},
			{
				type: "delegation.context.append",
				delegation_item_id: "delegation-1",
				channel: "speakable",
				content: [{ type: "input_text", text: "Finished" }],
			},
		]);
	});
	test("voice startup projects mixed-provider history into V3 context", async () => {
		let sidecarContext: unknown;
		const userEntry = {
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
		const workingEntry = {
			type: "message",
			id: "working-message",
			parentId: userEntry.id,
			timestamp: new Date(2).toISOString(),
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "Checking files" },
					{ type: "toolCall", id: "call-1", name: "read", arguments: {} },
				],
				stopReason: "toolUse",
				timestamp: 2,
			},
		};
		const toolEntry = {
			type: "message",
			id: "tool-message",
			parentId: workingEntry.id,
			timestamp: new Date(3).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "large code dump" }],
				isError: false,
				timestamp: 3,
			},
		};
		const answerEntry = {
			type: "message",
			id: "answer-message",
			parentId: toolEntry.id,
			timestamp: new Date(4).toISOString(),
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "final private reasoning" },
					{ type: "text", text: "This is the final answer." },
				],
				stopReason: "stop",
				timestamp: 4,
			},
		};
		const delegationEntry = {
			type: "custom_message",
			id: "voice-delegation",
			parentId: answerEntry.id,
			timestamp: new Date(5).toISOString(),
			customType: "gippity-realtime-delegation",
			content:
				"<realtime_delegation><input>Now inspect tests</input></realtime_delegation>",
			display: false,
			details: {},
		};
		const entries = [
			userEntry,
			workingEntry,
			toolEntry,
			answerEntry,
			delegationEntry,
		];
		const model = {
			provider: "example",
			id: "text-model",
			maxTokens: 4_096,
			reasoning: true,
		};
		const provider = {
			async *streamSimple(
				_model: unknown,
				context: unknown,
				_options: unknown,
			) {
				sidecarContext = context;
				yield {
					type: "done",
					message: { content: [{ type: "text", text: "summary" }] },
				};
			},
		};
		const ctx = {
			sessionManager: {
				getEntries: () => entries,
				getBranch: () => entries,
				getLeafId: () => delegationEntry.id,
				getSessionId: () => "mixed-provider-session",
			},
			modelRegistry: {
				find: () => model,
				getProvider: () => provider,
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token" }),
			},
		};

		const initialItems = await buildRealtimeInitialItems({
			ctx: ctx as never,
			config: {
				...DEFAULT_GIPPITY_CONTROL_CONFIG,
				voice: {
					...DEFAULT_GIPPITY_CONTROL_CONFIG.voice,
					contextModel: { provider: "example", modelId: "text-model" },
				},
			},
		});

		expect((sidecarContext as { tools?: unknown }).tools).toBeUndefined();
		const history = (
			sidecarContext as {
				messages: Array<{ content: Array<{ text: string }> }>;
			}
		).messages[0]!.content[0]!.text;
		expect(history).toContain("[User]: Inspect this screenshot");
		expect(history).toContain("[Assistant]: This is the final answer.");
		expect(history).toContain("[Realtime voice]: <realtime_delegation>");
		expect(history).not.toContain("private reasoning");
		expect(history).not.toContain("Checking files");
		expect(history).not.toContain("large code dump");
		expect(history).not.toContain("aW1hZ2U=");
		expect(initialItems?.[0]?.role).toBe("developer");
		expect(initialItems?.[0]?.content[0]?.text).toMatch(
			/<startup_context>\nsummary\n<\/startup_context>/,
		);
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

	test("voice turns finalize frontend history before delegation", () => {
		const turns = new RealtimeVoiceTurnTracker();
		turns.inputAdded("whatwerewe discussing");
		turns.userFinished("What were we discussing?");
		turns.outputAdded("This repo isa");
		turns.assistantFinished("This repo is a Pi toolkit.");
		turns.inputAdded("readthe readmes");
		expect(turns.delegated("Read the READMEs", "delegation-1")).toBeUndefined();
		turns.inputAdded("properly");
		expect(turns.userFinished("Read the READMEs")).toEqual({
			input: "Read the READMEs",
			transcriptDelta:
				"user: What were we discussing?\nassistant: This repo is a Pi toolkit.",
			delegationId: "delegation-1",
		});
		turns.delegationSettled("delegation-1");
		turns.inputAdded("thenrunthe tests");
		expect(
			turns.delegated("Then run the tests", "delegation-2"),
		).toBeUndefined();
		expect(turns.userFinished("Then run the tests")).toEqual({
			input: "Then run the tests",
			delegationId: "delegation-2",
		});
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
		messages.userTranscript("Can you check the server?");
		messages.voiceTurn({ input: "thanks" });

		expect(modelMessages).toEqual([]);
	});

	test("realtime session messages route one current Pi and V3 flow", () => {
		const sent: Array<{ message: any; options: unknown }> = [];
		const messages = new CodexVoiceSessionMessages(
			{
				sendMessage(message: unknown, options: unknown) {
					sent.push({ message, options });
				},
			} as unknown as ExtensionAPI,
			voiceMessageCallbacks(),
		);
		messages.setContext({ isIdle: () => true } as never);
		messages.modeStarted("realtime");
		messages.retainTranscriptTail("user: earlier conversation");
		messages.voiceTurn({
			input: "check the server",
			delegationId: "delegation-1",
		});
		messages.retainTranscriptTail("user: while Pi works");
		messages.voiceTurn({
			input: "also check the laptop",
			delegationId: "delegation-2",
		});
		messages.voiceStopped("realtime");

		expect(sent).toHaveLength(6);
		const lifecycle = { role: "custom", ...sent[0]!.message };
		const delegation = { role: "custom", ...sent[2]!.message };
		expect(sent[0]!.message.content).toMatch(
			/^<realtime_voice_session state="active">/,
		);
		expect(sent[1]!.message.customType).toBe("gippity-realtime-voice-tail");
		expect(sent[2]!.message).toMatchObject({
			customType: "gippity-realtime-delegation",
			content:
				"<realtime_delegation>\n  <input>check the server</input>\n</realtime_delegation>",
		});
		expect(sent[4]!.message.customType).toBe("gippity-realtime-delegation");
		expect(sent[5]!.message.content).toMatch(
			/^<realtime_voice_session state="ended">/,
		);
		expect(sent.map(({ options }) => options)).toEqual([
			{ triggerTurn: false, deliverAs: "steer" },
			{ triggerTurn: false, deliverAs: "steer" },
			{ triggerTurn: true },
			{ triggerTurn: false, deliverAs: "nextTurn" },
			{ triggerTurn: true, deliverAs: "steer" },
			{ triggerTurn: false, deliverAs: "steer" },
		]);
		expect(messages.filterContext([lifecycle, delegation] as never)).toEqual([
			lifecycle,
			delegation,
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

	test("preserves device handoff and restarts after explicit release", async () => {
		let hostStarts = 0;
		let hostConversation: object | undefined;
		const clients = testBrowserClients({
			async ensureConversation() {
				if (!hostConversation) {
					hostConversation = {};
					hostStarts += 1;
				}
			},
			onConversationActivity(active) {
				if (!active) hostConversation = undefined;
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
		second.receive({ type: "release" });
		await settle();
		second.receive({ type: "start", mode: "conversation" });
		await settle();
		expect(hostStarts).toBe(2);
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
	onConversationActivity?(active: boolean): void | Promise<void>;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: overrides.onConversationActivity ?? (() => {}),
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
