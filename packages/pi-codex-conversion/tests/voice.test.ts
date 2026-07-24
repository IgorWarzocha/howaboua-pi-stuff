import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setKittyProtocolActive } from "@earendil-works/pi-tui";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildDictationSessionUpdate, decodedBase64ByteLength, utf8Chunks } from "../src/voice/controller.ts";
import { parseVoiceHelperEvent } from "../src/voice/helper.ts";
import { renderRealtimeConversationInput, renderRealtimeDelegation } from "../src/voice/prompts.ts";
import { buildVoiceSetupInstructions, missingVoiceAudioSettings } from "../src/voice/setup.ts";
import { registerCodexVoiceShortcuts } from "../src/voice/shortcuts.ts";
import { ensureCodexVoiceSystemPrompt, loadCodexVoiceSystemPrompt, stripMarkdownComments } from "../src/voice/system-prompt.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";
import { CODEX_VOICE_MODE_MESSAGE_TYPE, CODEX_VOICE_SETUP_MESSAGE_TYPE, REALTIME_VOICE_MESSAGE_TYPE, codexVoiceModeMessage, codexVoiceSetupMessage, realtimeVoiceMessage } from "../src/voice/ui.ts";

test("voice helper events validate their discriminated payload", () => {
	assert.deepEqual(parseVoiceHelperEvent({ type: "ready", version: 2 }), { type: "ready", version: 2 });
	assert.deepEqual(parseVoiceHelperEvent({
		type: "devices",
		inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
		outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
	}), {
		type: "devices",
		inputs: [{ id: "input-1", name: "USB microphone", is_default: true }],
		outputs: [{ id: "output-1", name: "Headphones", is_default: false }],
	});
	assert.deepEqual(parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1 }), {
		type: "pcm", audio: "AA==", sample_rate: 24_000, num_channels: 1,
	});
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: [], sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "state", state: "x".repeat(129) }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "devices", inputs: ["input-1"], outputs: [] }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "surprise" }), /Invalid Codex voice helper/);
});

test("dictation uses manual commit audio instead of VAD", () => {
	const update = buildDictationSessionUpdate() as {
		session: { audio: { input: { turn_detection: unknown } } };
	};
	assert.equal(update.session.audio.input.turn_detection, null);
	assert.equal(decodedBase64ByteLength("AA=="), 1);
	assert.equal(decodedBase64ByteLength("AAAA"), 3);
});

test("voice shortcuts route push release, toggle dictation, and realtime independently", async () => {
	type ShortcutHandler = (ctx: ExtensionContext) => Promise<void> | void;
	let sessionStart: ((event: unknown, ctx: ExtensionContext) => void) | undefined;
	let terminalInput: ((data: string) => { consume?: boolean } | undefined) | undefined;
	const shortcuts = new Map<string, ShortcutHandler>();
	const notifications: string[] = [];
	const pi = {
		registerShortcut: (shortcut: string, options: { handler: ShortcutHandler }) => shortcuts.set(shortcut, options.handler),
		on: (event: string, handler: unknown) => { if (event === "session_start") sessionStart = handler as typeof sessionStart; },
	} as unknown as ExtensionAPI;
	const ctx = {
		ui: {
			onTerminalInput: (handler: typeof terminalInput) => { terminalInput = handler; return () => { terminalInput = undefined; }; },
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionContext;
	const config = structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	const calls = { start: 0, finish: 0, toggleDictation: 0, toggleRealtime: 0 };
	registerCodexVoiceShortcuts(pi, config, () => config, {
		startDictation: async () => { calls.start += 1; },
		finishDictation: async () => { calls.finish += 1; },
		toggleDictation: async () => { calls.toggleDictation += 1; },
		toggleRealtime: async () => { calls.toggleRealtime += 1; },
	});
	sessionStart?.({ type: "session_start" }, ctx);

	try {
		setKittyProtocolActive(true);
		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.equal(calls.start, 1);
		assert.deepEqual(terminalInput?.("\x1b[100;7:3u"), { consume: true });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(calls.finish, 1);

		config.voice.dictationShortcutMode = "toggle";
		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.equal(calls.toggleDictation, 1);
		await shortcuts.get("ctrl+alt+space")?.(ctx);
		assert.equal(calls.toggleRealtime, 1);

		config.voice.dictationShortcutMode = "push";
		setKittyProtocolActive(false);
		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.equal(calls.start, 1);
		assert.match(notifications.join("\n"), /key-release support/);
	} finally {
		setKittyProtocolActive(false);
	}
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

test("voice setup identifies missing devices and constructs a turn-visible message", () => {
	const missing = missingVoiceAudioSettings(DEFAULT_CODEX_CONVERSION_CONFIG);
	assert.deepEqual(missing, ["voice.inputDevice", "voice.outputDevice"]);
	assert.deepEqual(missingVoiceAudioSettings({
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		voice: { ...DEFAULT_CODEX_CONVERSION_CONFIG.voice, inputDevice: "mic-1", outputDevice: "speaker-1" },
	}), []);

	const instructions = buildVoiceSetupInstructions({
		configPath: "/agent/pi-codex-conversion.json",
		helperPath: "/package/pi-codex-voice",
		missing,
		projectRealtimePromptPath: "/repo/.pi/REALTIME-SYSTEM-PROMPT.md",
		realtimePromptPath: "/agent/REALTIME-SYSTEM-PROMPT.md",
		retryCommand: "/codex voice realtime",
	});
	const message = codexVoiceSetupMessage(instructions);
	assert.equal(message.customType, CODEX_VOICE_SETUP_MESSAGE_TYPE);
	assert.equal(message.content, instructions);
	assert.deepEqual(message.details, { instructions });
	assert.equal(message.display, true);
	assert.match(instructions, /voice\.inputDevice, voice\.outputDevice/);
	assert.match(instructions, /list_devices/);
	assert.match(instructions, /ask the user which they prefer/);
	assert.match(instructions, /hold Ctrl\+Alt\+D to dictate/);
	assert.match(instructions, /Ctrl\+Alt\+Space toggles realtime voice/);
	assert.match(instructions, /voice\.dictationShortcutMode/);
	assert.match(instructions, /\/agent\/pi-codex-conversion\.json/);
	assert.match(instructions, /Read the Realtime System Prompt at \/agent\/REALTIME-SYSTEM-PROMPT\.md/);
	assert.match(instructions, /\/repo\/\.pi\/REALTIME-SYSTEM-PROMPT\.md/);
	assert.match(instructions, /run \/codex voice realtime again/);
});

test("voice prompt creation preserves existing customization and strips visible guidance", () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-prompt-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	const projectPromptPath = join(directory, ".pi", "REALTIME-SYSTEM-PROMPT.md");
	try {
		assert.deepEqual(ensureCodexVoiceSystemPrompt(promptPath), { created: true });
		assert.match(readFileSync(promptPath, "utf8"), /<!--.+not sent to the model.+-->/);

		const customized = `<!-- visible guidance -->\n## Interface and role\nOne assistant.\n\n## Delegation\nRoute work.\n\n## Backend results\nSummarize results.`;
		writeFileSync(promptPath, customized);
		assert.deepEqual(ensureCodexVoiceSystemPrompt(promptPath), { created: false });
		assert.equal(loadCodexVoiceSystemPrompt(promptPath), "## Interface and role\nOne assistant.\n\n## Delegation\nRoute work.\n\n## Backend results\nSummarize results.");

		mkdirSync(dirname(projectPromptPath), { recursive: true });
		writeFileSync(projectPromptPath, "<!-- local guidance -->\n## Workspace voice\nCall this project Acme.");
		assert.equal(
			loadCodexVoiceSystemPrompt(promptPath, projectPromptPath),
			"## Interface and role\nOne assistant.\n\n## Delegation\nRoute work.\n\n## Backend results\nSummarize results.\n\n# Project level instructions\n\n## Workspace voice\nCall this project Acme.",
		);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});

test("voice prompt validation reports missing sections and malformed comments only when loaded", () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-prompt-invalid-"));
	const promptPath = join(directory, "REALTIME-SYSTEM-PROMPT.md");
	try {
		writeFileSync(promptPath, "## Identity and tone\nHello");
		assert.throws(() => loadCodexVoiceSystemPrompt(promptPath), /missing required sections: Interface and role, Delegation, Backend results/);
		assert.throws(() => stripMarkdownComments("hello <!-- unfinished"), /unclosed Markdown comment/);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
