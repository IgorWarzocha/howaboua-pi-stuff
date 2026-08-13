import assert from "node:assert/strict";
import test from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";

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
		prepareDelegation: async () => undefined,
		onDelegation: () => {},
		onDelegationFailed: () => {},
		onWorking: () => {},
	};
}
