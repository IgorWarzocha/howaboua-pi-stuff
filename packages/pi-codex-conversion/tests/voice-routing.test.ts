import assert from "node:assert/strict";
import test from "node:test";
import type {
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { RealtimeDelegationHandoff } from "../src/voice/conversation/handoff.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";

test("voice routing preserves presentation, handoff pacing, and compaction order", async () => {
	const modelMessages: Array<{ message: unknown; options: unknown }> = [];
	let prepareOperation: Promise<undefined> = Promise.resolve(undefined);
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
