import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setKittyProtocolActive } from "@earendil-works/pi-tui";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveWebSocketProxyForTarget } from "../src/providers/openai-codex/websocket-connection.ts";
import { CodexVoiceController } from "../src/voice/controller.ts";
import { CodexRealtimeConversation, realtimePeerStateFailure, utf8Chunks } from "../src/voice/conversation/session.ts";
import { CodexDictationSession, buildDictationSessionUpdate, decodedBase64ByteLength } from "../src/voice/dictation/session.ts";
import { parseVoiceHelperEvent, type VoiceHelperClient, type VoiceHelperCommand, type VoiceHelperEvent } from "../src/voice/helper.ts";
import { renderRealtimeConversationInput, renderRealtimeDelegation } from "../src/voice/prompts.ts";
import { buildVoiceSetupInstructions, missingVoiceAudioSettings } from "../src/voice/setup.ts";
import { registerCodexVoiceShortcuts } from "../src/voice/shortcuts.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
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
	assert.deepEqual(parseVoiceHelperEvent({ type: "data", message: { type: "turn.done" } }), {
		type: "data", message: { type: "turn.done" },
	});
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: [], sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "not base64", sample_rate: 24_000, num_channels: 1 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "pcm", audio: "AA==", sample_rate: 48_000, num_channels: 2 }), /Invalid Codex voice helper/);
	assert.throws(() => parseVoiceHelperEvent({ type: "data", message: { transcript: "x".repeat(64 * 1024) } }), /Invalid Codex voice helper/);
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

test("stopping dictation aborts only an in-flight WebSocket setup", async () => {
	const helper = {
		onEvent: () => () => {},
		onExit: () => () => {},
		start: async () => {},
		stop: async () => {},
		close: async () => {},
	} as unknown as VoiceHelperClient;
	const session = new CodexDictationSession({ onError: () => {}, onStatus: () => {}, onTranscript: () => {} });
	const internal = session as unknown as {
		helper: VoiceHelperClient;
		connector: (_url: string, _headers: Headers, signal: AbortSignal | undefined) => Promise<never>;
	};
	internal.helper = helper;
	const setupStarted = Promise.withResolvers<AbortSignal>();
	internal.connector = (_url, _headers, signal) => new Promise((_resolve, reject) => {
		assert.ok(signal);
		setupStarted.resolve(signal);
		signal.addEventListener("abort", () => reject(new Error("setup aborted")), { once: true });
	});
	const starting = session.start(
		{ headers: new Headers(), baseUrl: "https://api.openai.com/v1", officialCodex: true },
		DEFAULT_CODEX_CONVERSION_CONFIG,
	);
	const signal = await setupStarted.promise;
	await session.finish();
	assert.equal(signal.aborted, true);
	await assert.rejects(starting, /setup aborted/);
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

test("voice session messages wait for Pi idle and preserve delegation ordering", () => {
	const sent: Array<{ message: { details?: unknown }; triggerTurn: boolean }> = [];
	let idle = false;
	let voiceActive = true;
	const delegated: string[] = [];
	const pi = {
		sendMessage: (message: { details?: unknown }, options?: { triggerTurn?: boolean }) => {
			sent.push({ message, triggerTurn: options?.triggerTurn ?? false });
		},
	} as unknown as ExtensionAPI;
	const ctx = { isIdle: () => idle } as unknown as ExtensionContext;
	const messages = new CodexVoiceSessionMessages(pi, {
		canDelegate: () => true,
		isVoiceActive: () => voiceActive,
		onDelegation: (id) => delegated.push(id),
		onWorking: () => {},
	});
	messages.setContext(ctx);
	messages.modeStarted("realtime");
	messages.voiceTurn({ input: "casual conversation" });
	messages.voiceTurn({ input: "do the work", delegationId: "delegation-1" });
	assert.equal(sent.length, 0);

	idle = true;
	messages.agentSettled();
	assert.deepEqual(sent.map(({ message, triggerTurn }) => ({ details: message.details, triggerTurn })), [
		{ details: { mode: "realtime", state: "started" }, triggerTurn: false },
		{ details: { input: "casual conversation", route: "conversation" }, triggerTurn: false },
		{ details: { input: "do the work", route: "delegation" }, triggerTurn: true },
	]);
	assert.deepEqual(delegated, ["delegation-1"]);
	assert.equal(messages.consumeDelegatedTurnStart(), true);
	assert.equal(messages.consumeDelegatedTurnStart(), false);

	voiceActive = false;
	idle = false;
	messages.voiceStopped("realtime");
	assert.notDeepEqual(sent.at(-1)?.message.details, { mode: "realtime", state: "ended" });
	idle = true;
	messages.agentSettled();
	assert.deepEqual(sent.at(-1)?.message.details, { mode: "realtime", state: "ended" });
});

test("realtime handoff chunks preserve Unicode under the byte limit", () => {
	const input = `start ${"🙂".repeat(300)} end`;
	const chunks = utf8Chunks(input, 500);
	assert.equal(chunks.join(""), input);
	assert.equal(chunks.every((chunk) => Buffer.byteLength(chunk) <= 500), true);
});

test("realtime peer terminal states fail the session", () => {
	assert.equal(realtimePeerStateFailure("failed"), "Codex realtime connection failed");
	assert.equal(realtimePeerStateFailure("closed"), "Codex realtime connection closed");
	assert.equal(realtimePeerStateFailure("disconnected"), undefined);
});

test("realtime call setup resolves proxy settings from Pi provider env", async () => {
	assert.equal(
		await resolveWebSocketProxyForTarget("https://chatgpt.com/backend-api/codex/realtime/calls", {
			HTTPS_PROXY: "http://proxy.test:8080",
			NO_PROXY: "",
		}),
		"http://proxy.test:8080",
	);
	assert.equal(
		await resolveWebSocketProxyForTarget("https://chatgpt.com/backend-api/codex/realtime/calls", {
			HTTPS_PROXY: "http://proxy.test:8080",
			NO_PROXY: "chatgpt.com",
		}),
		undefined,
	);
});

test("closing realtime voice aborts an in-flight call setup", async () => {
	const listeners = new Set<(event: VoiceHelperEvent) => void>();
	const helper = {
		onEvent: (listener: (event: VoiceHelperEvent) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
		onExit: () => () => {},
		start: async () => {},
		send: (command: VoiceHelperCommand) => {
			if (command.type === "start_v3") queueMicrotask(() => {
				for (const listener of listeners) listener({ type: "offer", sdp: "offer" });
			});
		},
		close: async () => {},
	} as unknown as VoiceHelperClient;
	const session = new CodexRealtimeConversation({ onError: () => {}, onStatus: () => {}, onTurn: () => {} });
	const internal = session as unknown as {
		helper: VoiceHelperClient;
		callSetup: (endpoint: string, headers: Headers, signal: AbortSignal, body: string, env?: Record<string, string>) => Promise<never>;
	};
	internal.helper = helper;
	const fetchStarted = Promise.withResolvers<AbortSignal>();
	let setupEnv: Record<string, string> | undefined;
	internal.callSetup = (_endpoint, _headers, signal, _body, env) => new Promise((_resolve, reject) => {
		setupEnv = env;
		fetchStarted.resolve(signal);
		signal.addEventListener("abort", () => reject(signal.reason), { once: true });
	});
	const starting = session.start(
		{ headers: new Headers(), baseUrl: "https://example.test", officialCodex: false, env: { HTTPS_PROXY: "http://proxy.test" } },
		DEFAULT_CODEX_CONVERSION_CONFIG,
		"instructions",
	);
	const signal = await fetchStarted.promise;
	assert.deepEqual(setupEnv, { HTTPS_PROXY: "http://proxy.test" });
	await session.close();
	assert.equal(signal.aborted, true);
	await assert.rejects(starting, { name: "AbortError" });
});

test("invalid realtime prompts leave the current voice session untouched", async () => {
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-controller-prompt-"));
	const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
	const notifications: string[] = [];
	let finishes = 0;
	try {
		process.env["PI_CODING_AGENT_DIR"] = directory;
		writeFileSync(join(directory, "REALTIME-SYSTEM-PROMPT.md"), "## Identity and tone\nHello");
		const controller = new CodexVoiceController({} as ExtensionAPI);
		const internal = controller as unknown as { state: unknown; announcedMode: unknown };
		internal.state = { type: "dictation", session: { finish: async () => { finishes += 1; } } };
		internal.announcedMode = "dictation";
		const ctx = {
			cwd: directory,
			isProjectTrusted: () => false,
			ui: { notify: (message: string) => notifications.push(message) },
		} as unknown as ExtensionContext;
		const config = structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
		config.voice.mode = "conversational";
		await controller.start(ctx, config);
		assert.equal(controller.status, "dictation");
		assert.equal(controller.activeMode, "dictation");
		assert.equal(finishes, 0);
		assert.match(notifications.join("\n"), /missing required sections/);
	} finally {
		if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
	}
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
	const missing = missingVoiceAudioSettings(DEFAULT_CODEX_CONVERSION_CONFIG, "realtime");
	assert.deepEqual(missing, ["voice.inputDevice", "voice.outputDevice"]);
	assert.deepEqual(missingVoiceAudioSettings(DEFAULT_CODEX_CONVERSION_CONFIG, "dictation"), ["voice.inputDevice"]);
	assert.deepEqual(missingVoiceAudioSettings({
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		voice: { ...DEFAULT_CODEX_CONVERSION_CONFIG.voice, inputDevice: "mic-1", outputDevice: "speaker-1" },
	}, "realtime"), []);
	assert.deepEqual(missingVoiceAudioSettings({
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		voice: { ...DEFAULT_CODEX_CONVERSION_CONFIG.voice, inputDevice: "mic-1" },
	}, "dictation"), []);

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
	assert.match(instructions, /keybind changes take effect after \/reload/);
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
