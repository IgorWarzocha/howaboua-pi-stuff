import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	realtimeHandoffChannel,
	RealtimeDelegationHandoff,
} from "../src/voice/conversation/handoff.ts";
import type { CodexRealtimePeer } from "../src/voice/conversation/peer.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

test("assistant message boundaries route clean realtime handoffs", () => {
	const sent: unknown[] = [];
	const handoff = new RealtimeDelegationHandoff(
		{ sendData: (message: unknown) => sent.push(message) } as unknown as CodexRealtimePeer,
		{
			isActive: () => true,
			onFailure: (error) => assert.fail(error),
			onSettled: () => undefined,
			onStatus: () => undefined,
		},
	);
	handoff.activate("delegation-1");
	handoff.stream("Checking cache");
	handoff.finishMessage(realtimeHandoffChannel("toolUse"));
	handoff.stream("Finished");
	handoff.finishMessage(realtimeHandoffChannel("stop"));
	assert.deepEqual(sent, [
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

test("voice turns finalize frontend history before delegation", () => {
	const turns = new RealtimeVoiceTurnTracker();
	turns.inputAdded("whatwerewe discussing");
	turns.userFinished("What were we discussing?");
	turns.outputAdded("This repo isa");
	turns.assistantFinished("This repo is a Pi toolkit.");
	turns.inputAdded("readthe readmes");
	assert.equal(turns.delegated("Read the READMEs", "delegation-1"), undefined);
	turns.inputAdded("properly");
	assert.deepEqual(turns.userFinished("Read the READMEs"), {
		input: "Read the READMEs",
		transcriptDelta:
			"user: What were we discussing?\nassistant: This repo is a Pi toolkit.",
		delegationId: "delegation-1",
	});
	turns.delegationSettled("delegation-1");
	turns.inputAdded("thenrunthe tests");
	assert.equal(
		turns.delegated("Then run the tests", "delegation-2"),
		undefined,
	);
	assert.deepEqual(turns.userFinished("Then run the tests"), {
		input: "Then run the tests",
		delegationId: "delegation-2",
	});
});

test("voice presentation entries never enter Pi model queues", () => {
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

	assert.deepEqual(modelMessages, []);
});

test("realtime session messages preflight an idle delegation and route one current Pi and V3 flow", async () => {
	const sent: Array<{ message: any; options: unknown }> = [];
	const events: string[] = [];
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				events.push(`send:${(message as { customType?: string }).customType ?? "unknown"}`);
				sent.push({ message, options });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation() {
				events.push("preflight");
			},
		},
	);
	messages.setContext({ isIdle: () => true } as never);
	messages.modeStarted("realtime");
	messages.retainTranscriptTail("user: earlier conversation");
	await messages.voiceTurn({
		input: "check the server",
		delegationId: "delegation-1",
	});
	messages.retainTranscriptTail("user: while Pi works");
	await messages.voiceTurn({
		input: "also check the laptop",
		delegationId: "delegation-2",
	});
	messages.voiceStopped("realtime");

	assert.equal(sent.length, 6);
	assert.equal(sent[0]?.message.customType, "codex-voice-mode");
	assert.match(sent[0]?.message.content, /^<realtime_voice_session state="active">/);
	assert.equal(sent[1]?.message.customType, "codex-realtime-voice-tail");
	assert.equal(sent[2]?.message.customType, "codex-realtime-delegation");
	assert.equal(
		sent[2]?.message.content,
		"<realtime_delegation>\n  <input>check the server</input>\n</realtime_delegation>",
	);
	assert.equal(sent[4]?.message.customType, "codex-realtime-delegation");
	assert.match(sent[5]?.message.content, /^<realtime_voice_session state="ended">/);
	assert.deepEqual(events, [
		"send:codex-voice-mode",
		"send:codex-realtime-voice-tail",
		"preflight",
		"send:codex-realtime-delegation",
		"send:codex-realtime-voice-tail",
		"send:codex-realtime-delegation",
		"send:codex-voice-mode",
	]);
	assert.deepEqual(
		sent.map(({ options }) => options),
		[
			{ triggerTurn: false, deliverAs: "steer" },
			{ triggerTurn: false, deliverAs: "steer" },
			{ triggerTurn: true },
			{ triggerTurn: false, deliverAs: "nextTurn" },
			{ triggerTurn: true, deliverAs: "steer" },
			{ triggerTurn: false, deliverAs: "steer" },
		],
	);
	const lifecycle = { role: "custom", ...sent[0]!.message };
	const delegation = { role: "custom", ...sent[2]!.message };
	assert.deepEqual(
		messages.filterContext([lifecycle, delegation] as never),
		[lifecycle, delegation],
	);
});

test("voice delegation steers without committing idle preflight when another turn starts", async () => {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const gate = Promise.withResolvers<void>();
	let idle = true;
	let commits = 0;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation() {
				await gate.promise;
				return { commit: () => { commits++; return true; }, rollback() {} };
			},
		},
	);
	messages.setContext({ isIdle: () => idle, ui: { notify() {} } } as never);
	const delivery = messages.voiceTurn({ input: "check the server", delegationId: "delegation-1" });
	await Promise.resolve();
	idle = false;
	gate.resolve();
	await delivery;

	assert.equal(commits, 0);
	assert.deepEqual(sent[0]?.options, { triggerTurn: true, deliverAs: "steer" });
});

test("voice delegation retries preflight when its prepared identity changes before commit", async () => {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	let prepares = 0;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation() {
				prepares++;
				return { commit: () => prepares !== 1, rollback() {} };
			},
		},
	);
	messages.setContext({ isIdle: () => true, ui: { notify() {} } } as never);

	await messages.voiceTurn({ input: "check the server", delegationId: "delegation-1" });

	assert.equal(prepares, 2);
	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0]?.options, { triggerTurn: true });
});

test("failed voice preflight preserves the delegation without triggering Pi", async () => {
	const sent: unknown[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const notifications: string[] = [];
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown) {
				sent.push(message);
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ customType, data });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation() {
				throw new Error("tool refresh failed");
			},
		},
	);
	messages.setContext({
		isIdle: () => true,
		ui: { notify(message: string) { notifications.push(message); } },
	} as never);

	await messages.voiceTurn({ input: "check the server", delegationId: "delegation-1" });

	assert.deepEqual(sent, []);
	assert.match(notifications[0] ?? "", /tool refresh failed/);
	assert.deepEqual(entries, [{
		customType: "codex-realtime-delegation",
		data: {
			input: "check the server",
			route: "delegation",
			error: "tool refresh failed",
		},
	}]);
});

test("failed voice preflight commit rolls back and settles the delegation", async () => {
	const entries: Array<{ customType: string; data: unknown }> = [];
	const notifications: string[] = [];
	let rollbacks = 0;
	let failedDelegations = 0;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage() {
				throw new Error("Pi must not run");
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ customType, data });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			onDelegationFailed() { failedDelegations++; },
			async prepareDelegation() {
				return {
					commit() { throw new Error("tool refresh changed"); },
					rollback() { rollbacks++; },
				};
			},
		},
	);
	messages.setContext({
		isIdle: () => true,
		ui: { notify(message: string) { notifications.push(message); } },
	} as never);

	await messages.voiceTurn({ input: "check the server", delegationId: "delegation-1" });

	assert.equal(rollbacks, 1);
	assert.equal(failedDelegations, 1);
	assert.match(notifications[0] ?? "", /tool refresh changed/);
	assert.deepEqual(entries, [{
		customType: "codex-realtime-delegation",
		data: {
			input: "check the server",
			route: "delegation",
			error: "tool refresh changed",
		},
	}]);
});

test("voice restart discards an awaiting delegation and starts a fresh queue", async () => {
	const sent: Array<{ message: any; options: unknown }> = [];
	const firstPreflight = Promise.withResolvers<void>();
	let prepares = 0;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation() {
				prepares++;
				if (prepares === 1) await firstPreflight.promise;
				return { commit: () => true, rollback() {} };
			},
		},
	);
	const ctx = { isIdle: () => true, ui: { notify() {} } } as never;
	messages.setContext(ctx);
	const stale = messages.voiceTurn({ input: "old request", delegationId: "delegation-old" });
	await Promise.resolve();
	messages.voiceStopped();
	messages.setContext(ctx);

	await messages.voiceTurn({ input: "new request", delegationId: "delegation-new" });
	assert.equal(sent.length, 1);
	assert.match(sent[0]!.message.content, /new request/);

	firstPreflight.resolve();
	await stale;
	assert.equal(sent.length, 1);
});

test("voice shutdown can drain a delegation accepted before closing", async () => {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const preflight = Promise.withResolvers<void>();
	let canDelegate = true;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				sent.push({ message, options });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			canDelegate: () => canDelegate,
			async prepareDelegation() {
				await preflight.promise;
				return { commit: () => true, rollback() {} };
			},
		},
	);
	messages.setContext({ isIdle: () => true, ui: { notify() {} } } as never);
	void messages.voiceTurn({ input: "final request", delegationId: "delegation-final" });
	canDelegate = false;
	preflight.resolve();
	await messages.waitForDelegations();

	assert.equal(sent.length, 1);
	assert.deepEqual(sent[0]?.options, { triggerTurn: true });
});

test("voice shutdown cancels preflight that outlives session close", async () => {
	const sent: unknown[] = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown) {
				sent.push(message);
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ customType, data });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			async prepareDelegation(_ctx, signal) {
				await new Promise<void>((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
				});
			},
		},
	);
	messages.setContext({ isIdle: () => true, ui: { notify() {} } } as never);
	void messages.voiceTurn({ input: "final request", delegationId: "delegation-final" });
	await Promise.resolve();

	messages.cancelPendingDelegations();
	await messages.waitForDelegations();

	assert.deepEqual(sent, []);
	assert.deepEqual(entries, [{
		customType: "codex-realtime-delegation",
		data: {
			input: "final request",
			route: "delegation",
			error: "Voice session stopped before the delegation was prepared",
		},
	}]);
});

test("failed Pi send rolls back voice preflight before the next delegation", async () => {
	const sent: Array<{ message: unknown; options: unknown }> = [];
	const entries: Array<{ customType: string; data: unknown }> = [];
	const notifications: string[] = [];
	let failSend = true;
	let prepares = 0;
	let commits = 0;
	let rollbacks = 0;
	let failedDelegations = 0;
	const messages = new CodexVoiceSessionMessages(
		{
			sendMessage(message: unknown, options: unknown) {
				if (failSend) throw new Error("stale Pi runtime");
				sent.push({ message, options });
			},
			appendEntry(customType: string, data: unknown) {
				entries.push({ customType, data });
			},
		} as unknown as ExtensionAPI,
		{
			...voiceMessageCallbacks(),
			onDelegationFailed() { failedDelegations++; },
			async prepareDelegation() {
				prepares++;
				return {
					commit() { commits++; return true; },
					rollback() { rollbacks++; },
				};
			},
		},
	);
	messages.setContext({
		isIdle: () => true,
		ui: { notify(message: string) { notifications.push(message); } },
	} as never);

	await messages.voiceTurn({ input: "first request", delegationId: "delegation-1" });
	failSend = false;
	await messages.voiceTurn({ input: "second request", delegationId: "delegation-2" });

	assert.equal(prepares, 2);
	assert.equal(commits, 2);
	assert.equal(rollbacks, 1);
	assert.equal(failedDelegations, 1);
	assert.match(notifications[0] ?? "", /stale Pi runtime/);
	assert.deepEqual(entries, [{
		customType: "codex-realtime-delegation",
		data: {
			input: "first request",
			route: "delegation",
			error: "stale Pi runtime",
		},
	}]);
	assert.deepEqual(sent[0]?.options, { triggerTurn: true });
});

function voiceMessageCallbacks() {
	return {
		canDelegate: () => true,
		prepareDelegation: async () => undefined,
		onDelegation: () => {},
		onDelegationFailed: () => {},
		onWorking: () => {},
	};
}
