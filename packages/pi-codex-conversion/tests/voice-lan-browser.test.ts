import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";
import { LanVoiceBrowserClients } from "../src/voice/lan/browser-clients.ts";

test("LAN browser preserves handoff and restarts after explicit release", async () => {
	let hostStarts = 0;
	let hostConversation: object | undefined;
	const received: Buffer[] = [];
	const inputLevels: boolean[] = [];
	const clients = testBrowserClients({
		async ensureConversation() {
			if (!hostConversation) {
				hostConversation = {};
				hostStarts += 1;
			}
		},
		onConversationAudio(pcm) {
			received.push(pcm);
		},
		onConversationInputTooQuiet(inputTooQuiet) {
			inputLevels.push(inputTooQuiet);
		},
		onConversationActivity(active) {
			if (!active) hostConversation = undefined;
		},
	});
	const first = new TestWebSocket();
	clients.connectAudio("first", first.asWebSocket());
	first.receive({ type: "start", mode: "conversation" });
	await settle();
	const quietFrame = pcmFrame(100);
	for (let frame = 0; frame < 50; frame += 1) first.receiveBinary(quietFrame);
	first.receiveBinary(pcmFrame(1_000));
	first.close();
	await settle();

	const second = new TestWebSocket();
	clients.connectAudio("second", second.asWebSocket());
	second.receive({ type: "start", mode: "conversation" });
	await settle();
	assert.equal(hostStarts, 1);
	assert.equal(received.length, 51);
	assert.deepEqual(inputLevels, [true, false]);
	assert.deepEqual(
		second.sent.map((value) => JSON.parse(value)),
		[
			{ type: "connected" },
			{ type: "active", mode: "conversation", muted: false },
		],
	);
	second.receive({ type: "release" });
	await settle();
	second.receive({ type: "start", mode: "conversation" });
	await settle();
	assert.equal(hostStarts, 2);
	await clients.close();
});

test("LAN browser takeover shares an in-progress host conversation setup", async () => {
	const setup = Promise.withResolvers<void>();
	let hostStarts = 0;
	let sharedSetup: Promise<void> | undefined;
	const inputLevels: boolean[] = [];
	const clients = testBrowserClients({
		ensureConversation() {
			if (!sharedSetup) {
				hostStarts += 1;
				sharedSetup = setup.promise;
			}
			return sharedSetup;
		},
		onConversationInputTooQuiet(inputTooQuiet) {
			inputLevels.push(inputTooQuiet);
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
	assert.deepEqual(second.sent.map((value) => JSON.parse(value)).at(-1), {
		type: "active",
		mode: "conversation",
		muted: false,
	});
	const quietFrame = pcmFrame(100);
	for (let frame = 0; frame < 50; frame += 1) second.receiveBinary(quietFrame);
	const third = new TestWebSocket();
	clients.connectAudio("third", third.asWebSocket());
	third.receive({ type: "start", mode: "conversation" });
	await settle();
	assert.deepEqual(inputLevels, [true, false]);
	await clients.close();
});

function testBrowserClients(overrides: {
	ensureConversation(): Promise<void>;
	onConversationActivity?(active: boolean): void | Promise<void>;
	onConversationInputTooQuiet?(inputTooQuiet: boolean): void;
	onConversationAudio?(pcm: Buffer): void;
}): LanVoiceBrowserClients {
	return new LanVoiceBrowserClients({
		...overrides,
		startDictation: async () => {},
		finishDictation: async () => {},
		cancelDictation: async () => {},
		onConversationActivity: overrides.onConversationActivity ?? (() => {}),
		onConversationMute: () => {},
		conversationMuted: () => false,
		onConversationInputTooQuiet:
			overrides.onConversationInputTooQuiet ?? (() => {}),
		onConversationAudio: overrides.onConversationAudio ?? (() => {}),
		onDictationAudio: () => {},
	});
}

function pcmFrame(peak: number): Buffer {
	const frame = Buffer.alloc(480 * 2);
	for (let sample = 0; sample < 480; sample += 1)
		frame.writeInt16LE(peak, sample * 2);
	return frame;
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
	receiveBinary(value: Buffer): void {
		this.emit("message", value, true);
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

async function settle(): Promise<void> {
	await new Promise((resolve) => setImmediate(resolve));
}
