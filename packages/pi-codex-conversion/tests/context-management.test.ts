import test from "node:test";
import assert from "node:assert/strict";
import { normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
	createContextWindowMessage,
} from "../src/context-management/messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../src/context-management/window-kickoff.ts";
import { CodexContextTreeCoordinator } from "../src/context-management/tree-coordinator.ts";
import { buildRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { codexModel } from "./openai-codex-test-support.ts";

function createContext(): ExtensionContext {
	return {
		cwd: "/repo",
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api",
			contextWindow: 272_000,
		},
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "session-context",
		},
		getContextUsage: () => ({
			tokens: 12_000,
			contextWindow: 272_000,
			percent: 4.4,
		}),
		isIdle: () => true,
		isProjectTrusted: () => false,
	} as never;
}

test("context windows preserve rollover and native request semantics", async () => {
	const contextMessages: Array<Record<string, unknown>> = [];
	const contextPi = {
		sendMessage(message: Record<string, unknown>) {
			contextMessages.push(message);
		},
	} as never;
	const manager = new CodexContextWindowManager(async () => "Recovered checkpoint");
	const ctx = createContext();
	manager.ensureInitialized(contextPi, ctx, true);
	const contextEntries = () =>
		contextMessages.map((message, index) => ({
			type: "custom_message",
			id: "entry-" + index,
			parentId: index === 0 ? null : "entry-" + (index - 1),
			timestamp: new Date(index).toISOString(),
			customType: message["customType"],
			content: message["content"],
			display: message["display"],
			details: message["details"],
		}));
	const compactionEvent = () => ({
		reason: "threshold",
		branchEntries: contextEntries(),
		preparation: {
			firstKeptEntryId: "default-cut",
			tokensBefore: 240_000,
		},
	}) as never;

	assert.equal(manager.recordBudget(ctx, "remote", 230_000), undefined);
	const reminder = manager.recordBudget(ctx, "remote", 232_000);
	assert.equal(reminder?.type, "custom_message");
	assert.match(String(reminder?.content), /context_window_reminder/);
	assert.equal(contextMessages.length, 1, "boundary drafts must not enqueue steering");
	assert.equal(manager.recordBudget(ctx, "remote", 232_000), undefined);
	assert.match(String(manager.recordBudget(ctx, "remote", 250_000)?.content), /Urgent/);
	assert.equal(manager.recordBudget(ctx, "remote", 250_000), undefined);

	for (const mode of ["local", "tree", "remote"] as const) {
		const sessionManager = SessionManager.inMemory("/repo");
		const noteCtx = { ...ctx, sessionManager };
		const window = createContextWindowMessage("Window", "window", {
			firstWindowId: "saved-window", currentWindowId: "saved-window", windowNumber: 0,
		});
		sessionManager.appendCustomMessageEntry(window.customType, window.content, true, window.details);
		const user = sessionManager.appendMessage({ role: "user", content: "Save progress", timestamp: 1 });
		const assistant: AssistantMessage = {
			role: "assistant", content: [], stopReason: "stop", timestamp: 2,
			api: "openai-codex-responses", provider: "openai-codex", model: "gpt-6-luna",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
		};
		const call = sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "save", name: "notes", arguments: { action: "write_file", path: "state", text: "state" },
		}] });
		const result = { role: "toolResult" as const, toolCallId: "save", toolName: "notes", isError: false,
			content: [{ type: "text" as const, text: "saved" }], timestamp: 3,
			details: { codexHistoryNotes: mode === "remote" ? { encrypted_output: "opaque" } : { source: "pi-session" } } };
		const write = sessionManager.appendMessage(result);
		const quietPi = { sendMessage() {}, sendUserMessage() {}, events: { emit() {} } } as never;
		const restored = () => {
			const fresh = new CodexContextWindowManager();
			fresh.ensureInitialized(quietPi, noteCtx, true);
			return fresh;
		};
		const reuse = (customInstructions?: string) => {
			const fresh = restored();
			fresh.prepareCompaction({ reason: "manual", customInstructions, signal: new AbortController().signal } as never, mode);
			return fresh.finishManualCheckpointRequest(quietPi, noteCtx,
				{ type: "session_compact_failed", reason: "manual", aborted: true, willRetry: false, fromExtension: false }, true);
		};
		assert.equal(restored().recordBudget(noteCtx, mode, 250_000), undefined, "persisted writes suppress reminders");
		assert.equal(reuse(), false, "an unfinished run cannot silently roll over");
		const final = sessionManager.appendMessage({ ...assistant, content: [{ type: "text", text: "Saved" }] });
		assert.equal(reuse(), true, "fresh runtime recovers completed save from the conversation");
		assert.equal(reuse("Preserve extra detail"), false);
		sessionManager.appendMessage({ role: "user", content: "New work", timestamp: 4 });
		assert.equal(reuse(), false, "new input invalidates the checkpoint");
		sessionManager.branch(final);
		sessionManager.appendCustomEntry("metadata", {});
		assert.equal(reuse(), true, "tree return to the saved response ignores bookkeeping");
		sessionManager.appendCustomMessageEntry("peer-input", "More work", true);
		assert.equal(reuse(), false, "peer input is conversation too");
		sessionManager.branch(final);
		sessionManager.appendContextEdit(write, null);
		assert.equal(reuse(), false, "omitted evidence cannot grant checkpoint credit");
		for (const invalid of [{ ...result, isError: true }, { ...result, toolCallId: "wrong-call" }]) {
			sessionManager.branch(call);
			sessionManager.appendMessage(invalid);
			sessionManager.appendMessage(assistant);
			assert.equal(reuse(), false, "only a successful matched write counts");
		}
		sessionManager.branch(final);
		sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "work", name: "exec", arguments: { code: "work()" },
		}] });
		sessionManager.appendMessage({ ...result, toolCallId: "work", toolName: "exec" });
		sessionManager.appendMessage(assistant);
		assert.equal(reuse(), false, "work after a save invalidates it even without a new user turn");
		sessionManager.branch(user);
		sessionManager.appendMessage(assistant);
		assert.equal(reuse(), false, "abandoned branch saves do not count");
	}

	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "remote"), { cancel: true });
	assert.equal(await manager.startNewWindow(contextPi, ctx, {
		mode: "remote",
		trimPreviousWindow: true,
	}), true);
	assert.equal(contextMessages.length, 2);
	assert.equal(contextMessages.every(
		(message) => message["customType"] === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	), true);

	const activeWindow = manager.project([
		{ role: "user", content: "old window", timestamp: 1 },
		...contextMessages.map((message, index) => ({
			...message,
			role: "custom",
			timestamp: index + 2,
		})),
	] as never, "remote");
	assert.equal(activeWindow.length, 1);
	assert.match((activeWindow[0] as { content: string }).content, /Recovered checkpoint/);
	const currentWindowId = (
		contextMessages[1]!["details"] as {
			contextManagement: { currentWindowId: string };
		}
	).contextManagement.currentWindowId;
	assert.deepEqual(manager.remaining(ctx), {
		remainingTokens: 260_000,
		remainingPercent: 95.6,
		windowId: currentWindowId,
		contextWindow: 272_000,
	});
	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "local"), {
		compaction: {
			summary: CONTEXT_WINDOW_COMPACTION_SUMMARY,
			firstKeptEntryId: "entry-1",
			tokensBefore: 240_000,
			details: {
				protocol: 1,
				strategy: "codex-context-window",
				windowId: currentWindowId,
			},
		},
	});

	const contextBridge = new CodexDeveloperMessageBridge();
	const contextKickoff = new CodexContextWindowKickoff(manager);
	const contextState: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "code",
		codexTurnState: createCodexTurnState(),
		developerMessages: contextBridge,
		contextWindows: manager,
		contextKickoff,
		contextTree: new CodexContextTreeCoordinator(manager, contextKickoff),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			compaction: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
				contextManagement: "remote",
			},
		},
	};
	const routerTools = buildRequestBody(codexModel, normalizeContext({
		messages: [],
		tools: createHistoryNotesTools(),
	})).tools as Array<{
		name: string;
		parameters: {
			additionalProperties: boolean;
			properties: Record<string, Record<string, unknown>>;
		};
	}>;
	const contextPayload = await rewriteCodexProviderRequest(
		{
			model: "gpt-5.6",
			tools: routerTools,
			input: contextBridge.prepare(activeWindow, true).map((message) => ({
				role: "user",
				content: [{
					type: "input_text",
					text: (message as { content: string }).content,
				}],
			})),
		},
		ctx,
		contextState,
	) as {
		input: Array<{ role: string }>;
		client_metadata: Record<string, string>;
		tools: Array<{
			type: string;
			name: string;
			tools: Array<{
				name: string;
				parameters: {
					properties: Record<string, Record<string, unknown>>;
				};
			}>;
		}>;
	};
	assert.deepEqual(contextPayload.input.map(({ role }) => role), ["developer"]);
	assert.deepEqual(
		contextPayload.tools.map(({ type, name }) => [type, name]),
		[["namespace", "history"], ["namespace", "notes"]],
	);
	for (const namespace of contextPayload.tools) {
		for (const operation of namespace.tools) {
			assert.equal(Object.hasOwn(operation.parameters, "additionalProperties"), false);
			for (const property of Object.values(operation.parameters.properties))
				assert.equal(Object.hasOwn(property, "minimum"), false);
		}
	}
	const notesWrite = contextPayload.tools[1]!.tools.find(
		(operation) => operation.name === "write_file",
	)!;
	assert.equal(notesWrite.parameters.properties["text"]!["encrypted"], true);

	const metadata = JSON.parse(
		contextPayload.client_metadata["x-codex-turn-metadata"]!,
	) as Record<string, unknown>;
	assert.deepEqual(
		{
			window_id: metadata["window_id"],
			window_number: metadata["window_number"],
			context_window_id: metadata["context_window_id"],
		},
		{
			window_id: "session-context:1",
			window_number: 1,
			context_window_id: currentWindowId,
		},
	);
});
