import { expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
	RealtimeDelegationHandoff,
	realtimeHandoffChannel,
} from "../src/voice/conversation/handoff.ts";
import type { CodexRealtimePeer } from "../src/voice/conversation/peer.ts";
import { completedVoiceReasoningSummary } from "../src/voice/reasoning-summary.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";

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
	handoff.finishMessage(realtimeHandoffChannel("toolUse"), "Silent summary");
	handoff.stream("Checking cache");
	handoff.finishMessage(
		realtimeHandoffChannel("toolUse"),
		"Suppressed summary",
	);
	handoff.stream("Finished");
	handoff.finishMessage(realtimeHandoffChannel("stop"));
	expect(sent).toEqual([
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
	expect(
		completedVoiceReasoningSummary({
			model: "azure-deployment",
			responseModel: "gpt-5.6-sol",
			content: [{ type: "thinking", thinking: "Completed summary" }],
		}),
	).toBe("Completed summary");
	expect(
		completedVoiceReasoningSummary({
			model: "deepseek-v4-pro",
			content: [{ type: "thinking", thinking: "Raw reasoning" }],
		}),
	).toBeUndefined();
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
	expect(turns.delegated("Then run the tests", "delegation-2")).toBeUndefined();
	expect(turns.userFinished("Then run the tests")).toEqual({
		input: "Then run the tests",
		delegationId: "delegation-2",
	});
	turns.delegationSettled("delegation-2");
	turns.inputAdded("handle this next");
	expect(turns.userFinished("Handle this next")).toBeUndefined();
	turns.outputAdded("On it");
	expect(turns.assistantFinished("On it")).toEqual({ input: "On it" });
	expect(turns.assistantFinished("Still on it")).toEqual({
		input: "Still on it",
	});
	expect(turns.delegated("Handle this next", "delegation-3")).toEqual({
		input: "Handle this next",
		delegationId: "delegation-3",
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

function voiceMessageCallbacks() {
	return {
		canDelegate: () => true,
		onDelegation: () => {},
		onWorking: () => {},
	};
}
