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
			getEntries: () => [],
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
	assert.match(String(reminder?.content), /context_window_reminder/);
	assert.equal(manager.recordBudget(ctx, "remote", 232_000), undefined);
	assert.match(String(manager.recordBudget(ctx, "remote", 250_000)?.content), /Urgent/);

	for (const mode of ["local", "tree", "remote"] as const) {
		const sessionManager = SessionManager.inMemory("/repo");
		const beforeMarker = sessionManager.appendMessage({ role: "user", content: "Selected destination context", timestamp: 0 });
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
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, Number.MAX_SAFE_INTEGER), false);
		sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "cleanup", name: "exec", arguments: { code: "cleanup()" },
		}] });
		assert.equal(reuse(), false, "a pending tool batch cannot silently roll over");
		sessionManager.appendMessage({ ...result, toolCallId: "cleanup", toolName: "exec", details: {} });
		assert.equal(restored().recordBudget(noteCtx, mode, 250_000), undefined, "later tools in the same run do not stale notes");
		const final = sessionManager.appendMessage({ ...assistant, content: [{ type: "text", text: "Saved" }] });
		const finishedAt = Date.parse(sessionManager.getBranch().at(-1)!.timestamp) + 60_000;
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 60 * 60_000), false, "a final reply alone does not prove settlement");
		restored().recordSettledCheckpoint({ appendEntry: (type: string, data: unknown) => sessionManager.appendCustomEntry(type, data) } as never,
			noteCtx, mode, finishedAt);
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 25 * 60_000 - 1), false);
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 25 * 60_000), true, "idle age survives a fresh manager on the persisted branch");
		assert.equal(restored().hasIdleNotesCheckpoint({ ...noteCtx, isIdle: () => false }, mode, finishedAt + 26 * 60_000), false);
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, "off", finishedAt + 26 * 60_000), false);
		assert.equal(reuse(), true, "fresh runtime recovers notes saved before cleanup in the completed run");
		assert.equal(reuse("Preserve extra detail"), false);
		sessionManager.appendCustomMessageEntry("peer-input", "More work", true);
		assert.equal(reuse(), false, "visible peer input invalidates the checkpoint");
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 26 * 60_000), false);
		sessionManager.branch(final);
		sessionManager.appendCustomEntry("metadata", {});
		assert.equal(reuse(), true, "tree return to the saved response ignores bookkeeping");
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 26 * 60_000), true);
		sessionManager.appendContextEdit(write, null);
		assert.equal(reuse(), false, "omitted evidence cannot grant checkpoint credit");
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 26 * 60_000), false);
		for (const invalid of [{ ...result, isError: true }, { ...result, toolCallId: "wrong-call" }]) {
			sessionManager.branch(call);
			sessionManager.appendMessage(invalid);
			sessionManager.appendMessage(assistant);
			assert.equal(reuse(), false, "only a successful matched write counts");
			assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 26 * 60_000), false);
		}
		sessionManager.branch(final);
		sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "work", name: "exec", arguments: { code: "work()" },
		}] });
		sessionManager.appendMessage({ ...result, toolCallId: "work", toolName: "exec" });
		sessionManager.appendMessage(assistant);
		assert.equal(reuse(), false, "a later run cannot reuse notes from before the previous final reply");
		assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, finishedAt + 26 * 60_000), false);
		for (const name of ["exec", "wait"] as const) {
			for (const saved of [true, false]) {
				sessionManager.branch(user);
				sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
					type: "toolCall", id: "nested-save", name, arguments: {},
				}] });
				sessionManager.appendMessage({ ...result, toolCallId: "nested-save", toolName: name,
					details: { codeMode: true, contextNotesSaved: saved } });
				sessionManager.appendMessage(assistant);
				const eligible = saved && mode !== "remote";
				assert.equal(reuse(), eligible, "only successful Local/Tree nested checkpoints count");
				const settledAt = Date.parse(sessionManager.getBranch().at(-1)!.timestamp);
				restored().recordSettledCheckpoint({ appendEntry: (type: string, data: unknown) => sessionManager.appendCustomEntry(type, data) } as never,
					noteCtx, mode, settledAt);
				assert.equal(restored().hasIdleNotesCheckpoint(noteCtx, mode, settledAt + 26 * 60_000), eligible);
			}
		}
		sessionManager.branch(user);
		sessionManager.appendMessage(assistant);
		assert.equal(reuse(), false, "abandoned branch saves do not count");

		const prompted = restored();
		const prompts: string[] = [];
		const promptedPi = {
			sendMessage(message: { customType: string; content: string; display: boolean; details: unknown }) {
				sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
			},
			sendUserMessage(content: string) {
				prompts.push(content);
				sessionManager.appendMessage({ role: "user", content, timestamp: 4 });
			},
			events: { emit() {} },
		} as never;
		prompted.prepareCompaction({ reason: "manual", signal: new AbortController().signal } as never, mode);
		assert.equal(prompted.finishManualCheckpointRequest(promptedPi, noteCtx,
			{ type: "session_compact_failed", reason: "manual", aborted: true, willRetry: false, fromExtension: false }, true), false);
		assert.deepEqual(prompts, ["Continue."], "only the note-saving run requires a prompt");
		prompted.ensureInitialized(promptedPi, noteCtx, true); // Pi refreshes the window on input before the prompted run.
		prompted.beginPromptedManualCheckpointRun();
		sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "checkpoint", name: "notes", arguments: { action: "write_file", path: "state", text: "now" },
		}] });
		sessionManager.appendMessage({ ...result, toolCallId: "checkpoint" });
		sessionManager.appendMessage({ ...assistant, stopReason: "toolUse", content: [{
			type: "toolCall", id: "later", name: "exec", arguments: { code: "cleanup()" },
		}] });
		sessionManager.appendMessage({ ...result, toolCallId: "later", toolName: "exec", details: {} });
		sessionManager.appendMessage({ ...assistant, content: [{ type: "text", text: "Checkpoint saved" }] });
		assert.equal(prompted.finishPromptedManualCheckpoint(noteCtx, true), "ready");
		assert.equal(prompted.finishPromptedManualCheckpoint(noteCtx, true), undefined, "rollover request is consumed once");
		const promptedKickoff = new CodexContextWindowKickoff(prompted);
		assert.equal(await promptedKickoff.startWindow(promptedPi, noteCtx,
			{ mode, trimPreviousWindow: mode !== "tree", triggerTurn: false }), true);
		assert.deepEqual(prompts, ["Continue."], "no agent turn starts in the new window");
		prompted.prepareCompaction({ reason: "manual", signal: new AbortController().signal } as never, mode);
		assert.equal(prompted.finishManualCheckpointRequest(promptedPi, noteCtx,
			{ type: "session_compact_failed", reason: "manual", aborted: true, willRetry: false, fromExtension: false }, true), false);
		prompted.beginPromptedManualCheckpointRun();
		sessionManager.appendMessage({ ...assistant, content: [{ type: "text", text: "Could not save a note" }] });
		assert.equal(prompted.finishPromptedManualCheckpoint(noteCtx, true), "missing", "failed checkpoint cannot roll over");
		assert.equal(prompted.finishPromptedManualCheckpoint(noteCtx, true), undefined, "a later run cannot satisfy the failed request");

		sessionManager.branchWithSummary(beforeMarker, "Read notes at the exact handoff path before resuming");
		const navigationWindow = new CodexContextWindowManager(async () => undefined);
		const persistedPi = { sendMessage: (message: { customType: string; content: string; display: boolean; details: unknown }) => {
			sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
		} } as never;
		navigationWindow.ensureInitialized(persistedPi, noteCtx, true);
		const projected = () => JSON.stringify(navigationWindow.project(
			sessionManager.buildSessionContext().messages, mode, sessionManager.getBranch(), sessionManager.getEntries(),
		));
		assert.match(projected(), /exact handoff path/, "initializing a window after navigation must not hide the handoff");
		assert.match(projected(), /Selected destination context/);
		await navigationWindow.startNewWindow(persistedPi, noteCtx, { mode, trimPreviousWindow: true });
		assert.doesNotMatch(projected(), /exact handoff path|Selected destination context/, "only explicit rollover cuts the previous conversation");
	}

	assert.deepEqual(manager.prepareCompaction(compactionEvent(), "remote"), { cancel: true });
	assert.equal(await manager.startNewWindow(contextPi, ctx, {
		mode: "remote",
		trimPreviousWindow: true,
	}), true);
	assert.equal(contextMessages.length, 2);

	const activeWindow = manager.project([
		{ role: "user", content: "old window", timestamp: 1 },
		...contextMessages.map((message, index) => ({
			...message,
			role: "custom",
			timestamp: index + 2,
		})),
	] as never, "remote");
	assert.match((activeWindow[0] as { content: string }).content, /Recovered checkpoint/);
	const currentWindowId = (
		contextMessages[1]!["details"] as {
			contextManagement: { currentWindowId: string };
		}
	).contextManagement.currentWindowId;
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
	const notifications: string[] = [];
	const inputCtx = { ...ctx, ui: { ...ctx.ui, notify: (message: string) => { notifications.push(message); } } };
	let release!: (started: boolean) => void;
	const preparing = contextKickoff.prepareIdleInput(inputCtx, () => new Promise<boolean>((resolve) => { release = resolve; }));
	assert.equal(contextKickoff.hasIdleInput, true);
	const queued = contextKickoff.prepareIdleInput(inputCtx,
		async () => { throw new Error("queued input must not start another rollover"); });
	await Promise.resolve();
	release(true);
	assert.deepEqual(await preparing, { action: "continue" });
	assert.deepEqual(await queued, { action: "continue" }, "reentrant admission is released independently after the shared rollover");
	assert.equal(contextKickoff.hasIdleInput, false);
	let failedInputFinished = false;
	const failedInput = contextKickoff.prepareIdleInput(inputCtx, async () => false).then((result) => { failedInputFinished = true; return result; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(failedInputFinished, false, "failure cannot admit or discard the original input");
	assert.match(notifications[0]!, /pending/);
	const retry = contextKickoff.prepareIdleInput(inputCtx, async () => true);
	assert.deepEqual(await failedInput, { action: "continue" });
	assert.deepEqual(await retry, { action: "continue" });
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
				continuity: "notes",
				historyStorage: "remote",
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
