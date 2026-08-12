import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	realtimeHandoffChannel,
	RealtimeDelegationHandoff,
} from "../src/voice/conversation/handoff.ts";
import type { CodexRealtimePeer } from "../src/voice/conversation/peer.ts";
import { completedVoiceReasoningSummary } from "../src/voice/reasoning-summary.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";

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
	handoff.finishMessage(realtimeHandoffChannel("toolUse"), "Silent summary");
	handoff.stream("Checking cache");
	handoff.finishMessage(realtimeHandoffChannel("toolUse"), "Suppressed summary");
	handoff.stream("Finished");
	handoff.finishMessage(realtimeHandoffChannel("stop"));
	assert.deepEqual(sent, [
		{
			type: "delegation.context.append",
			delegation_item_id: "delegation-1",
			channel: "commentary",
			content: [{ type: "input_text", text: "Silent summary" }],
		},
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
	assert.equal(
		completedVoiceReasoningSummary({
			model: "azure-deployment",
			responseModel: "grok-4.6",
			content: [{ type: "thinking", thinking: "Completed summary" }],
		}),
		"Completed summary",
	);
	assert.equal(
		completedVoiceReasoningSummary({
			model: "deepseek-v4-pro",
			content: [{ type: "thinking", thinking: "Raw reasoning" }],
		}),
		undefined,
	);
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

function voiceMessageCallbacks() {
	return {
		canDelegate: () => true,
		onDelegation: () => {},
		onDelegationFailed: () => {},
		onWorking: () => {},
	};
}
