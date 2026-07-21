import { expect, test } from "bun:test";
import {
	createAssistantMessageEventStream,
	type Model,
} from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionBeforeCompactEvent,
} from "@earendil-works/pi-coding-agent";
import rescue from "../index.js";

const model = {
	provider: "rescue-test",
	api: "rescue-test-api",
	id: "rescue-model",
	name: "Rescue model",
	contextWindow: 128_000,
	maxTokens: 4_096,
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as Model<any>;

function event(): SessionBeforeCompactEvent {
	return {
		type: "session_before_compact",
		preparation: {
			firstKeptEntryId: "keep",
			messagesToSummarize: [
				{ role: "user", content: "Preserve this context", timestamp: 1 },
			] as never,
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 100,
			previousSummary: undefined,
			fileOps: { read: [], written: [], edited: [] },
			settings: { reserveTokens: 100, keepRecentTokens: 100 },
		},
		branchEntries: [],
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	};
}

function setup(stopReason: "length" | "stop") {
	const handlers = new Map<
		string,
		(event: never, ctx: ExtensionContext) => unknown
	>();
	const commands = new Map<
		string,
		{ handler: (args: string, ctx: ExtensionContext) => Promise<void> }
	>();
	const notifications: string[] = [];
	let compactCalls = 0;
	const streamSimple = () => {
		const stream = createAssistantMessageEventStream();
		const message = {
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "complete summary" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 1,
				output: 1,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason,
			timestamp: 1,
		};
		queueMicrotask(() => {
			stream.push({ type: "done", reason: stopReason, message });
			stream.end();
		});
		return stream;
	};
	const pi = {
		on(
			name: string,
			handler: (event: never, ctx: ExtensionContext) => unknown,
		) {
			handlers.set(name, handler);
		},
		registerCommand(
			name: string,
			command: {
				handler: (args: string, ctx: ExtensionContext) => Promise<void>;
			},
		) {
			commands.set(name, command);
		},
	} as unknown as ExtensionAPI;
	rescue(pi);

	const ctx = {
		hasUI: true,
		model,
		waitForIdle: async () => {},
		ui: { notify: (message: string) => notifications.push(message) },
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "test" }),
			getProvider: () => ({ streamSimple }),
		},
		compact: () => {
			compactCalls++;
		},
	} as unknown as ExtensionContext;

	return {
		commands,
		compactCalls: () => compactCalls,
		ctx,
		event: event(),
		handlers,
		notifications,
	};
}

test("cancels rescue when the model response is truncated", async () => {
	const testSetup = setup("length");
	const command = testSetup.commands.get("rescue");
	if (!command) throw new Error("rescue command was not registered");
	await command.handler("", testSetup.ctx);
	const result = await testSetup.handlers.get("session_before_compact")?.(
		testSetup.event as never,
		testSetup.ctx,
	);

	expect(result).toEqual({ cancel: true });
});

test("does not queue overlapping rescue requests", async () => {
	const testSetup = setup("stop");
	const command = testSetup.commands.get("rescue");
	if (!command) throw new Error("rescue command was not registered");

	await Promise.all([
		command.handler("first", testSetup.ctx),
		command.handler("second", testSetup.ctx),
	]);

	expect(testSetup.compactCalls()).toBe(1);
	expect(testSetup.notifications).toContain(
		"Rescue compaction already in progress",
	);
});
