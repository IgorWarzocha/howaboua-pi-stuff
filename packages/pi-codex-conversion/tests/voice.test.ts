import assert from "node:assert/strict";
import test from "node:test";
import { utf8Chunks } from "../src/voice/controller.ts";
import { parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { renderRealtimeDelegation } from "../src/voice/prompts.ts";

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
