import assert from "node:assert/strict";
import test from "node:test";
import { utf8Chunks } from "../src/voice/controller.ts";
import { parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { renderRealtimeConversationInput, renderRealtimeDelegation } from "../src/voice/prompts.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";
import { REALTIME_VOICE_MESSAGE_TYPE, realtimeVoiceMessage } from "../src/voice/ui.ts";

test("voice helper events validate their discriminated payload", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 1 }), { type: "ready", version: 1 });
	assert.deepEqual(parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1 }), {
		type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1,
	});
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: [], sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "state", state: "x".repeat(129) }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }), /Invalid Codex voice helper/);
});

test("realtime handoff chunks preserve Unicode under the byte limit", () => {
	const input = `start ${"🙂".repeat(300)} end`;
	const chunks = utf8Chunks(input, 500);
	assert.equal(chunks.join(""), input);
	assert.equal(chunks.every((chunk) => Buffer.byteLength(chunk) <= 500), true);
});

test("realtime delegations use the Codex envelope and escape transcripts", () => {
	assert.equal(
		renderRealtimeDelegation("inspect a < b && c > d"),
		"<realtime_delegation>\n  <input>inspect a &lt; b &amp;&amp; c &gt; d</input>\n</realtime_delegation>",
	);
});

test("realtime voice messages keep model payload separate from display input", () => {
	const message = realtimeVoiceMessage("check the current branch", "delegation");
	assert.equal(message.customType, REALTIME_VOICE_MESSAGE_TYPE);
	assert.equal(message.content, "<realtime_delegation>\n  <input>check the current branch</input>\n</realtime_delegation>");
	assert.deepEqual(message.details, { input: "check the current branch", route: "delegation" });
	assert.equal(message.display, true);

	const conversation = realtimeVoiceMessage("hello <Codex>", "conversation");
	assert.equal(conversation.content, renderRealtimeConversationInput("hello <Codex>"));
	assert.match(conversation.content, /hello &lt;Codex&gt;/);
	assert.deepEqual(conversation.details, { input: "hello <Codex>", route: "conversation" });
});

test("realtime turn routing handles both protocol event orders without duplicate cards", () => {
	const tracker = new RealtimeVoiceTurnTracker();

	tracker.userFinished("raw delegated request");
	assert.deepEqual(tracker.delegated("clean delegated request", "delegation-1"), {
		input: "clean delegated request",
		delegationId: "delegation-1",
	});
	assert.equal(tracker.assistantFinished(), undefined);

	assert.deepEqual(tracker.delegated("early delegation", "delegation-2"), {
		input: "early delegation",
		delegationId: "delegation-2",
	});
	tracker.userFinished("late raw transcript");
	assert.equal(tracker.assistantFinished(), undefined);

	tracker.userFinished("casual conversation");
	assert.deepEqual(tracker.assistantFinished(), { input: "casual conversation" });
});
