import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { setKittyProtocolActive } from "@earendil-works/pi-tui";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { registerCodexCommand } from "../src/ui/settings/command.ts";
import { CodexVoiceController } from "../src/voice/controller.ts";
import { CodexRealtimeConversation, utf8Chunks } from "../src/voice/conversation/session.ts";
import { CodexDictationSession } from "../src/voice/dictation/session.ts";
import { BoundedJsonlReader, parseVoiceHelperEvent, type VoiceHelperClient, type VoiceHelperCommand, type VoiceHelperEvent } from "../src/voice/helper.ts";
import { missingVoiceAudioSettings } from "../src/voice/setup.ts";
import { registerCodexVoiceShortcuts } from "../src/voice/shortcuts.ts";
import { CodexVoiceSessionMessages } from "../src/voice/session-messages.ts";
import { ensureCodexVoiceSystemPrompt, loadCodexVoiceSystemPrompt } from "../src/voice/system-prompt.ts";
import { RealtimeVoiceTurnTracker } from "../src/voice/turns.ts";
import { REALTIME_VOICE_MESSAGE_TYPE, realtimeVoiceMessage } from "../src/voice/ui.ts";

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

test("voice helper JSONL framing bounds unterminated stdout before buffering", () => {
	const lines: string[] = [];
	let oversized = 0;
	const reader = new BoundedJsonlReader(8, (line) => lines.push(line), () => { oversized += 1; });
	reader.push(Buffer.from("one\r\ntw"));
	reader.push(Buffer.from("o\n12345678"));
	assert.deepEqual(lines, ["one", "two"]);
	reader.push(Buffer.from("9"));
	assert.equal(oversized, 1);
	reader.push(Buffer.from("\nignored"));
	reader.end();
	assert.equal(oversized, 1);
	assert.deepEqual(lines, ["one", "two"]);
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
	let sessionShutdown: (() => void) | undefined;
	let terminalInput: ((data: string) => { consume?: boolean } | undefined) | undefined;
	const shortcuts = new Map<string, ShortcutHandler>();
	const pi = {
		registerShortcut: (shortcut: string, options: { handler: ShortcutHandler }) => shortcuts.set(shortcut, options.handler),
		on: (event: string, handler: unknown) => {
			if (event === "session_start") sessionStart = handler as typeof sessionStart;
			if (event === "session_shutdown") sessionShutdown = handler as typeof sessionShutdown;
		},
	} as unknown as ExtensionAPI;
	const ctx = {
		ui: {
			onTerminalInput: (handler: typeof terminalInput) => { terminalInput = handler; return () => { terminalInput = undefined; }; },
			notify: () => {},
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

	try {
		setKittyProtocolActive(true);
		sessionStart?.({ type: "session_start" }, ctx);
		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.equal(calls.start, 1);
		assert.deepEqual(terminalInput?.("\x1b[100;1:3u"), { consume: true });
		await new Promise<void>((resolve) => setImmediate(resolve));
		assert.equal(calls.finish, 1);

		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.deepEqual(terminalInput?.("\x1b[100;7:1u"), { consume: true });
		await new Promise((resolve) => setTimeout(resolve, 150));
		assert.equal(calls.finish, 2);

		config.voice.dictationShortcutMode = "toggle";
		await shortcuts.get("ctrl+alt+d")?.(ctx);
		assert.equal(calls.toggleDictation, 1);
		await shortcuts.get("ctrl+alt+space")?.(ctx);
		assert.equal(calls.toggleRealtime, 1);
	} finally {
		sessionShutdown?.();
		setKittyProtocolActive(false);
	}
});

test("voice stop command does not wait for the agent turn", async () => {
	type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void>;
	const directory = mkdtempSync(join(tmpdir(), "codex-voice-stop-command-"));
	const previousAgentDir = process.env["PI_CODING_AGENT_DIR"];
	let handler: CommandHandler | undefined;
	let stops = 0;
	try {
		process.env["PI_CODING_AGENT_DIR"] = directory;
		const pi = {
			registerCommand: (_name: string, options: { handler: CommandHandler }) => { handler = options.handler; },
			registerShortcut: () => {},
			on: () => {},
		} as unknown as ExtensionAPI;
		const state = { config: structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG) };
		const voice = {
			activeMode: "realtime",
			stop: async () => { stops += 1; },
		};
		registerCodexCommand(pi, state as never, voice as never);
		assert.ok(handler);
		await handler("voice stop", {
			mode: "tui",
			waitForIdle: async () => { throw new Error("voice stop waited for idle"); },
			ui: { notify: () => {} },
		} as unknown as ExtensionContext);
		assert.equal(stops, 1);
	} finally {
		if (previousAgentDir === undefined) delete process.env["PI_CODING_AGENT_DIR"];
		else process.env["PI_CODING_AGENT_DIR"] = previousAgentDir;
		rmSync(directory, { recursive: true, force: true });
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

	voiceActive = true;
	messages.setContext(ctx);
	messages.modeStarted("dictation");
	messages.voiceStopped("dictation");
	messages.modeStarted("dictation");
	messages.voiceStopped("dictation");
	assert.equal(sent.filter(({ message }) => JSON.stringify(message.details) === JSON.stringify({ mode: "dictation", state: "started" })).length, 1);
	assert.equal(sent.some(({ message }) => JSON.stringify(message.details) === JSON.stringify({ mode: "dictation", state: "ended" })), false);

	messages.resetContextAnnouncements();
	messages.modeStarted("dictation");
	assert.equal(sent.filter(({ message }) => JSON.stringify(message.details) === JSON.stringify({ mode: "dictation", state: "started" })).length, 2);
});

test("realtime handoff chunks preserve Unicode under the byte limit", () => {
	const input = `start ${"🙂".repeat(300)} end`;
	const chunks = utf8Chunks(input, 500);
	assert.equal(chunks.join(""), input);
	assert.equal(chunks.every((chunk) => Buffer.byteLength(chunk) <= 500), true);
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

test("realtime voice messages keep model payload separate from display input", () => {
	const message = realtimeVoiceMessage("check a < b", "delegation");
	assert.equal(message.customType, REALTIME_VOICE_MESSAGE_TYPE);
	assert.equal(message.content, "<realtime_delegation>\n  <input>check a &lt; b</input>\n</realtime_delegation>");
	assert.deepEqual(message.details, { input: "check a < b", route: "delegation" });
	assert.equal(message.display, true);

	const conversation = realtimeVoiceMessage("hello <Codex>", "conversation");
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

test("voice setup requires only devices used by the selected mode", () => {
	assert.deepEqual(missingVoiceAudioSettings(DEFAULT_CODEX_CONVERSION_CONFIG, "realtime"), ["voice.inputDevice", "voice.outputDevice"]);
	assert.deepEqual(missingVoiceAudioSettings(DEFAULT_CODEX_CONVERSION_CONFIG, "dictation"), ["voice.inputDevice"]);
	assert.deepEqual(missingVoiceAudioSettings({
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		voice: { ...DEFAULT_CODEX_CONVERSION_CONFIG.voice, inputDevice: "mic-1", outputDevice: "speaker-1" },
	}, "realtime"), []);
	assert.deepEqual(missingVoiceAudioSettings({
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		voice: { ...DEFAULT_CODEX_CONVERSION_CONFIG.voice, inputDevice: "mic-1" },
	}, "dictation"), []);
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
		assert.doesNotMatch(loadCodexVoiceSystemPrompt(promptPath), /visible guidance/);

		mkdirSync(dirname(projectPromptPath), { recursive: true });
		writeFileSync(projectPromptPath, "<!-- local guidance -->\n## Workspace voice\nCall this project Acme.");
		const layered = loadCodexVoiceSystemPrompt(promptPath, projectPromptPath);
		assert.match(layered, /# Project level instructions/);
		assert.match(layered, /## Workspace voice\nCall this project Acme\./);
	} finally {
		rmSync(directory, { recursive: true, force: true });
	}
});
