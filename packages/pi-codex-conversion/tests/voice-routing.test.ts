import assert from "node:assert/strict";
import test from "node:test";
import {
	convertToLlm,
	createEventBus,
	type ExtensionAPI,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { registerCodexDeveloperMessageBroker } from "../src/developer-messages.ts";
import { buildRequestBody } from "../src/providers/openai-codex/request-body.ts";
import { codexVoiceModeMessage } from "../src/voice/ui.ts";
import { model } from "./websocket-test-support.ts";
import { RealtimeDelegationHandoff } from "../src/voice/conversation/handoff.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";

type ExtensionMessage = Parameters<ExtensionAPI["sendMessage"]>[0];

test("voice routing preserves presentation, handoff pacing, and compaction order", async () => {
	const modelMessages: Array<{ message: ExtensionMessage; options: unknown }> = [];
	let prepareOperation: Promise<undefined> = Promise.resolve(undefined);
	const pi = {
		events: createEventBus(),
		appendEntry() {},
		sendMessage(message: ExtensionMessage, options: unknown) {
			modelMessages.push({ message, options });
		},
	} as unknown as ExtensionAPI;
	let active = true;
	const unregister = registerCodexDeveloperMessageBroker(pi, () => active);
	const messages = new CodexVoiceSessionMessages(
		pi,
		voiceMessageCallbacks(() => prepareOperation),
	);
	messages.modeStarted("dictation");
	messages.userTranscript("Can you check the server?");
	await messages.voiceTurn({ input: "thanks" });
	assert.deepEqual([...modelMessages], []);

	const contexts: unknown[] = [];
	const settled: string[] = [];
	const handoff = new RealtimeDelegationHandoff({
		isActive: () => true,
		onContext: (target, channel, content) =>
			contexts.push({ target, channel, content }),
		onSettled: (id) => settled.push(id),
	});
	handoff.activate("delegation-1");
	handoff.stream("First useful sentence. Second useful sentence.");
	handoff.progress("First useful sentence. Second useful sentence.");
	handoff.progress("Completed reasoning summary");
	handoff.result("Finished result");
	handoff.settle();
	handoff.piInput("Typed request");
	handoff.piInput("Queued request", "followUp");
	assert.equal(contexts.length, 4);
	handoff.piUserMessage({
		role: "user",
		content: [{ type: "text", text: "Queued request" }],
	});
	assert.deepEqual(contexts, [
		{
			target: { type: "session" },
			channel: "speakable",
			content: "First useful sentence. Second useful sentence.",
		},
		{
			target: { type: "session" },
			channel: "speakable",
			content: "Completed reasoning summary",
		},
		{
			target: { type: "delegation", id: "delegation-1" },
			channel: "speakable",
			content: "Finished result",
		},
		{
			target: { type: "session" },
			channel: "commentary",
			content:
				"<pi_steer>\n  <input>Typed request</input>\n  <routing>already delivered to the active Pi run; update context, do not delegate it, and wait for authoritative Pi updates</routing>\n</pi_steer>",
		},
		{
			target: { type: "session" },
			channel: "commentary",
			content:
				"<pi_steer>\n  <input>Queued request</input>\n  <routing>already delivered to the active Pi run; update context, do not delegate it, and wait for authoritative Pi updates</routing>\n</pi_steer>",
		},
	]);
	assert.deepEqual(settled, ["delegation-1"]);

	messages.setContext({
		isIdle: () => true,
		ui: { notify() {} },
	} as unknown as ExtensionContext);
	messages.compactionStarted();
	messages.setContext({
		isIdle: () => true,
		ui: { notify() {} },
	} as unknown as ExtensionContext);
	const delivery = messages.voiceTurn({
		input: "Queued after context replacement",
		delegationId: "delegation-2",
	});
	await Promise.resolve();
	assert.deepEqual([...modelMessages], []);
	messages.compactionFinished();
	await delivery;
	assert.equal(modelMessages.length, 1);
	assert.deepEqual(modelMessages[0]?.options, { triggerTurn: true });

	messages.agentSettled();
	const preflight = Promise.withResolvers<undefined>();
	prepareOperation = preflight.promise;
	const racedDelivery = messages.voiceTurn({
		input: "Queued when compaction starts during preflight",
		delegationId: "delegation-3",
	});
	await Promise.resolve();
	messages.compactionStarted();
	preflight.resolve(undefined);
	await Promise.resolve();
	assert.equal(modelMessages.length, 1);
	messages.compactionFinished();
	await racedDelivery;
	assert.equal(modelMessages.length, 2);

	messages.agentSettled();
	messages.modeStarted("realtime");
	messages.agentStarted();
	messages.conversationInputStopped();
	messages.retainTranscriptTail("A finalized user request");
	assert.equal(modelMessages.length, 5);
	for (const [index, state] of [[2, "started"], [3, "ended"]] as const) {
		const expected = codexVoiceModeMessage("realtime", state);
		const saved = modelMessages[index]!;
		assert.deepEqual(saved.options, { triggerTurn: false, deliverAs: "steer" });
		assert.deepEqual({ ...saved.message, details: expected.details }, expected);
		assert.equal((saved.message.details as typeof expected.details).mode, "realtime");
		assert.equal((saved.message.details as typeof expected.details).state, state);
	}
	const persisted = JSON.parse(JSON.stringify(modelMessages.map(({ message }, index) => ({ ...message, role: "custom", timestamp: index }))));
	const bridge = new CodexDeveloperMessageBridge();
	const projected = bridge.prepare(messages.filterContext(persisted), true);
	const body = bridge.rewritePayload(buildRequestBody(model, { messages: convertToLlm(projected) })) as { input: Array<{ role: string }> };
	assert.deepEqual(body.input.map(item => item.role), ["user", "user", "developer", "developer", "user"]);
	for (const index of [0, 1, 4]) assert.deepEqual(projected[index], persisted[index]);
	assert.deepEqual(bridge.prepare(persisted, false), persisted);
	active = false;
	messages.modeStarted("realtime");
	assert.deepEqual(modelMessages.at(-1), { message: codexVoiceModeMessage("realtime", "started"), options: { triggerTurn: false, deliverAs: "steer" } });
	unregister();
});

function voiceMessageCallbacks(prepareDelegation = async () => undefined) {
	return {
		canDelegate: () => true,
		prepareDelegation,
		onDelegation: () => {},
		onDelegationFailed: () => {},
		onWorking: () => {},
	};
}
