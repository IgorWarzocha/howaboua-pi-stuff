import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { utf8Chunks } from "../src/voice/controller.ts";
import { parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { renderRealtimeConversationInput, renderRealtimeDelegation } from "../src/voice/prompts.ts";
import { ensureCodexVoiceSystemPrompt, loadCodexVoiceSystemPrompt, stripMarkdownComments } from "../src/voice/system-prompt.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";
import { CODEX_VOICE_MODE_MESSAGE_TYPE, REALTIME_VOICE_MESSAGE_TYPE, codexVoiceModeMessage, realtimeVoiceMessage } from "../src/voice/ui.ts";

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

test("voice mode messages separate model context from their system-style display", () => {
	const realtime = codexVoiceModeMessage("realtime", "started");
	assert.equal(realtime.customType, CODEX_VOICE_MODE_MESSAGE_TYPE);
	assert.deepEqual(realtime.details, { mode: "realtime", state: "started" });
	assert.match(realtime.content, /state="active"/);
	assert.match(realtime.content, /speech-recognition errors/);
	assert.equal(realtime.display, true);

	const dictationEnded = codexVoiceModeMessage("dictation", "ended");
	assert.deepEqual(dictationEnded.details, { mode: "dictation", state: "ended" });
	assert.match(dictationEnded.content, /ordinary typed input/);
});

test("voice prompt creation preserves existing customization and strips visible guidance", () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-prompt-"));
	const promptPath = join(directory, "CODEX-VOICE-SYSTEM-PROMPT.md");
	try {
		assert.deepEqual(ensureCodexVoiceSystemPrompt(promptPath), { created: true });
		assert.match(readFileSync(promptPath, "utf8"), /<!--.+not sent to the model.+-->/);

		const customized = `<!-- visible guidance -->\n## Interface and role\nOne assistant.\n\n## Delegation\nRoute work.\n\n## Backend results\nSummarize results.`;
		writeFileSync(promptPath, customized);
		assert.deepEqual(ensureCodexVoiceSystemPrompt(promptPath), { created: false });
		assert.equal(loadCodexVoiceSystemPrompt(promptPath), "## Interface and role\nOne assistant.\n\n## Delegation\nRoute work.\n\n## Backend results\nSummarize results.");
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("voice prompt validation reports missing sections and malformed comments only when loaded", () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-prompt-invalid-"));
	const promptPath = join(directory, "CODEX-VOICE-SYSTEM-PROMPT.md");
	try {
		writeFileSync(promptPath, "## Identity and tone\nHello");
		assert.throws(() => loadCodexVoiceSystemPrompt(promptPath), /missing required sections: Interface and role, Delegation, Backend results/);
		assert.throws(() => stripMarkdownComments("hello <!-- unfinished"), /unclosed Markdown comment/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
