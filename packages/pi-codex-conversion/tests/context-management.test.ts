import test from "node:test";
import assert from "node:assert/strict";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { SessionManager, type CompactionResult, type ExtensionContext, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../src/context-management/window-kickoff.ts";
import { REMOTE_DELIVERY_MESSAGE } from "../src/context-management/remote-delivery.ts";
import { hasFreshContextNotes } from "../src/context-management/saved-notes.ts";
import { NOTE_SAVE_MARKER, recordNoteSaveMarker } from "../src/context-management/note-save-marker.ts";
import { createCodexCompactionLifecycle } from "../src/extension/compaction-lifecycle.ts";
import { createCodexTurnLifecycle } from "../src/extension/turn-lifecycle.ts";
import { createContextWindowTools } from "../src/context-management/tools.ts";

function createContext(sessionManager: SessionManager): ExtensionContext {
	return {
		cwd: process.cwd(),
		model: {
			provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api", contextWindow: 272_000,
		},
		sessionManager, isIdle: () => true, isProjectTrusted: () => false,
		ui: { notify() {} },
	} as never;
}

test("combined compaction stays in its window until new_context completes its checkpoint", async () => {
	// Tree has a distinct archive route. Local represents the non-Tree route.
	for (const mode of ["local", "tree"] as const) {
		const sessionManager = SessionManager.inMemory(process.cwd());
		const windows = new CodexContextWindowManager(async () => undefined);
		const pi = { sendMessage: (message: { customType: string; content: string; display: boolean; details: unknown }) => {
			sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
		} } as never;
		let completion: Parameters<ExtensionContext["compact"]>[0];
		const ctx = { ...createContext(sessionManager), compact: (options: typeof completion) => { completion = options; } };
		windows.ensureInitialized(pi, ctx, true);
		const identity = windows.currentIdentity();
		const treeRequests: Array<{ compactionEntryId: string; triggerTurn: boolean }> = [];
		const state = {
			enabled: true, executionMode: "code", contextWindows: windows,
			contextKickoff: new CodexContextWindowKickoff(windows),
			contextTree: { handoff: { active: false }, schedule: (_ctx: ExtensionContext, options: typeof treeRequests[number]) => {
				treeRequests.push(options);
				return true;
			} },
			config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, compaction: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
				continuity: "notes-and-compaction", historyStorage: mode, method: "pi",
			} },
		};
		const lifecycle = createCodexCompactionLifecycle(pi, {
			state, finishTurn() {}, resetTransportAfterCompaction() {}, startCompactionPrewarm: async () => {},
			voice: { announceContextTransition() {}, compactionStarted() {}, compactionFinished() {},
				resetContextAnnouncements() {}, refreshRealtimeContext: async () => {} },
		} as never, { checkpointNotebook: async () => {} } as never,
		async () => { assert.fail("combined compaction cannot use the notes-only rollover route"); },
		async () => true);
		const kept = sessionManager.appendMessage({ role: "user", content: "Continue work", timestamp: 1 });
		const preparation: SessionBeforeCompactEvent["preparation"] = {
			firstKeptEntryId: kept, tokensBefore: 240_000,
			messagesToSummarize: sessionManager.buildSessionContext().messages, turnPrefixMessages: [], isSplitTurn: false,
			fileOps: { read: new Set(), written: new Set(), edited: new Set() },
			settings: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 0 },
		};
		const event: SessionBeforeCompactEvent = { type: "session_before_compact", reason: "manual", preparation,
			branchEntries: sessionManager.getBranch(), signal: new AbortController().signal, willRetry: false };
		assert.equal(await lifecycle.beforeCompact(event, ctx), undefined, "Pi must produce the checkpoint, not a notes-only cut");
		const result: CompactionResult = { summary: "Pi checkpoint", firstKeptEntryId: kept, tokensBefore: preparation.tokensBefore };
		sessionManager.appendCompaction(result.summary, kept, result.tokensBefore);
		const entry = sessionManager.getBranch().at(-1);
		assert.ok(entry?.type === "compaction");
		const completed = { type: "session_compact" as const, reason: "manual" as const,
			compactionEntry: entry, fromExtension: false, willRetry: false };
		await lifecycle.compacted(completed, ctx);
		assert.deepEqual(windows.currentIdentity(), identity);
		assert.deepEqual(treeRequests, [], "ordinary Tree compaction cannot archive the window");

		const [newContext] = createContextWindowTools(pi, state as never);
		assert.equal((await newContext.execute("rollover", {}, undefined, undefined, {
			...ctx, tools: [], executeTool: async () => { assert.fail("rollover cannot execute nested tools"); },
		})).terminate, true);
		let continued!: () => void;
		const continuing = new Promise<void>((resolve) => { continued = resolve; });
		windows.finishTurn(ctx, async () => {
			await windows.startNewWindow(pi, ctx, { mode, trimPreviousWindow: false });
			continued();
		});
		assert.deepEqual(windows.currentIdentity(), identity, "new_context schedules rather than immediately rolling over");
		assert.equal(await lifecycle.beforeCompact({ ...event, branchEntries: sessionManager.getBranch() }, ctx), undefined);
		sessionManager.appendCompaction(result.summary, kept, result.tokensBefore);
		const rolloverEntry = sessionManager.getBranch().at(-1);
		assert.ok(rolloverEntry?.type === "compaction");
		await lifecycle.compacted({ ...completed, compactionEntry: rolloverEntry }, ctx);
		assert.deepEqual(windows.currentIdentity(), identity, "session_compact precedes the completion boundary");
		assert.deepEqual(treeRequests, mode === "tree" ? [{ compactionEntryId: rolloverEntry.id, triggerTurn: true }] : []);
		assert.ok(completion?.onComplete, "new_context must request a Pi completion callback");
		completion.onComplete(result);
		await continuing;
		assert.equal(windows.currentIdentity()?.windowNumber, 1);
		assert.equal(windows.currentIdentity()?.previousWindowId, identity?.currentWindowId);
		const payload = windows.rewritePayload({}, ctx) as { client_metadata: Record<string, string> };
		const metadata = JSON.parse(payload.client_metadata["x-codex-turn-metadata"]!);
		assert.deepEqual([metadata.window_id, metadata.window_number, metadata.context_window_id],
			[sessionManager.getSessionId() + ":1", 1, windows.currentIdentity()?.currentWindowId]);
	}
});

test("notes maintenance respects selected checkpoint evidence and Pi turn admission", async () => {
	const sessionManager = SessionManager.inMemory(process.cwd());
	const ctx = createContext(sessionManager);
	const pi = {
		sendMessage: (message: { customType: string; content: string; display: boolean; details: unknown }) =>
			sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
		appendEntry: (type: string, data: unknown) => sessionManager.appendCustomEntry(type, data),
		setLabel: (id: string, label: string) => sessionManager.appendLabelChange(id, label),
	} as never;
	const windows = new CodexContextWindowManager(async () => undefined);
	windows.ensureInitialized(pi, ctx, true);
	sessionManager.appendMessage({ role: "user", content: "Save progress", timestamp: 1 });
	const assistant: AssistantMessage = {
		role: "assistant", content: [], stopReason: "toolUse", timestamp: 2,
		api: "openai-codex-responses", provider: "openai-codex", model: "gpt-5.6",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	};
	const original = "save";
	const firstId = "00000000-0000-4000-8000-000000000001";
	const lastId = "00000000-0000-4000-8000-000000000002";
	sessionManager.appendMessage({ ...assistant, content: [{ type: "toolCall", id: original, name: "exec", arguments: {} }] });
	const source = sessionManager.appendMessage({ role: "toolResult", toolCallId: original, toolName: "exec", isError: false,
		content: [], timestamp: 3, details: { codeMode: true, cellId: "cell", status: "yielded", opaqueDeliveryId: firstId } });
	const delivery = { protocol: 2, origin: "host", sourceCallId: original, originalExecCallId: original,
		cellId: "cell", scope: "fixture", images: [] };
	sessionManager.appendCustomMessageEntry(REMOTE_DELIVERY_MESSAGE, "Remote results", false, { ...delivery,
		id: firstId, status: "yielded", outputs: [{ resultId: "write", name: "notes.write_file", encryptedOutput: "opaque" }] });
	sessionManager.appendMessage({ ...assistant, content: [{ type: "toolCall", id: "wait", name: "wait", arguments: {} }] });
	const receipt = sessionManager.appendMessage({ role: "toolResult", toolCallId: "wait", toolName: "wait", isError: false,
		content: [], timestamp: 4, details: { codeMode: true, cellId: "cell", status: "result", opaqueDeliveryId: lastId,
			contextNotesSaved: true, contextNotesSource: "remote" } });
	sessionManager.appendCustomMessageEntry(REMOTE_DELIVERY_MESSAGE, "Remote results", false, { ...delivery,
		id: lastId, sourceCallId: "wait", status: "result", contextNotesSaved: true, outputs: [] });
	const mark = () => recordNoteSaveMarker(pi, ctx, windows.currentIdentity()!.currentWindowId, "remote");
	const markers = () => sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === NOTE_SAVE_MARKER);
	mark();
	assert.equal(markers().length, 0, "a tool-result midpoint is not a completed checkpoint");
	const final = sessionManager.appendMessage({ ...assistant, stopReason: "stop" });
	const settledAt = Date.parse(sessionManager.getBranch().at(-1)!.timestamp);
	const freshNotes = () => hasFreshContextNotes(sessionManager.getBranch(), windows.currentIdentity()!.currentWindowId, "remote", true);
	const restored = () => {
		const fresh = new CodexContextWindowManager();
		fresh.ensureInitialized(pi, ctx, true);
		return fresh;
	};
	assert.equal(restored().isIdleRolloverDue(ctx, settledAt + 26 * 60_000), false, "a final reply is not settlement");
	windows.recordSettlement(pi, ctx, settledAt);
	const modelMessages = sessionManager.buildSessionProjection().messages;
	mark();
	assert.equal(sessionManager.getLabel(final), "Notes saved");
	assert.deepEqual(sessionManager.buildSessionProjection().messages, modelMessages, "markers and bookmarks stay model-invisible");
	sessionManager.branch(final);
	mark();
	assert.equal(markers().length, 1, "returning to the reply does not duplicate its marker");
	assert.equal(restored().isIdleRolloverDue(ctx, settledAt + 25 * 60_000 - 1), false);
	assert.equal(restored().isIdleRolloverDue(ctx, settledAt + 25 * 60_000), true, "idle age survives runtime replacement");
	const signal = new AbortController().signal;
	assert.deepEqual(windows.prepareCompaction({ reason: "manual", signal } as SessionBeforeCompactEvent, "remote"), { cancel: true });
	assert.equal(windows.finishManualCheckpointRequest(pi, ctx, { type: "session_compact_failed", reason: "manual", aborted: true,
		willRetry: false, fromExtension: true }, true), true,
		"plain /compact at the bookmarked reply reuses notes without another checkpoint turn");
	sessionManager.appendContextEdit(source, null);
	assert.equal(freshNotes(), false, "an omitted source cannot grant checkpoint credit");
	sessionManager.branch(receipt);
	sessionManager.appendMessage({ ...assistant, stopReason: "stop" });
	assert.equal(freshNotes(), false, "a receipt cannot replace its host delivery");
	sessionManager.branch(final);
	sessionManager.appendCustomMessageEntry("peer-input", "More work", true);
	assert.equal(freshNotes(), false, "new visible work invalidates saved notes");
	mark();
	assert.equal(markers().length, 1, "new work cannot mark old notes as a new checkpoint");
	for (const stopReason of ["aborted", "error"] as const) {
		sessionManager.branch(final);
		sessionManager.appendMessage({ ...assistant, stopReason });
		assert.equal(restored().isIdleRolloverDue(ctx, settledAt + 26 * 60_000), false, "an old settlement cannot prove a new terminal run");
		windows.recordSettlement(pi, ctx, settledAt);
		assert.equal(restored().isIdleRolloverDue(ctx, settledAt + 25 * 60_000), true, "terminal inactivity does not depend on successful completion");
		assert.equal(freshNotes(), false, "interruption cannot bless old notes as fresh");
		assert.equal(restored().isIdleRolloverDue({ ...ctx, isIdle: () => false }, settledAt + 26 * 60_000), false);
	}

	const kickoff = new CodexContextWindowKickoff(windows);
	let admitted = false;
	const input = kickoff.prepareIdleInput(ctx, async () => false).then(result => { admitted = true; return result; });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(admitted, false, "failed rollover cannot admit or discard the original input");
	const retry = kickoff.prepareIdleInput(ctx, async () => true);
	assert.deepEqual(await input, { action: "continue" });
	assert.deepEqual(await retry, { action: "continue" }, "retry releases both original SDK admissions");
	let checkpointPrompt = "";
	const checkpointPi = { sendMessage: (message: { customType: string; content: string; display: boolean; details: unknown }) =>
		sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
		sendUserMessage: (prompt: string) => { checkpointPrompt = prompt; },
		events: { emit() {} } } as never;
	let rollovers = 0;
	const held = kickoff.prepareIdleInput(ctx, async () => {
		await kickoff.prepareIdleCheckpoint(checkpointPi, ctx, "remote");
		rollovers++;
		return true;
	});
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(kickoff.admitCheckpointInput({ text: checkpointPrompt, source: "interactive" } as never), false);
	assert.equal(kickoff.admitCheckpointInput({ text: checkpointPrompt, source: "extension" } as never), true);
	assert.equal(kickoff.admitCheckpointInput({ text: checkpointPrompt, source: "extension" } as never), false);
	windows.beginPromptedManualCheckpointRun();
	const checkpointAbort = new AbortController();
	kickoff.observeCheckpointRun(checkpointAbort.signal);
	checkpointAbort.abort();
	kickoff.finishIdleCheckpoint(ctx, windows.finishPromptedManualCheckpoint(ctx, true));
	assert.deepEqual(await held, { action: "handled" }, "explicit abort cancels held input rather than replaying it");
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(rollovers, 0);
	assert.equal(kickoff.hasIdleInput, false);
	windows.promptNotesCheckpoint(checkpointPi, ctx, "remote");
	assert.equal(windows.admitPromptedCheckpointInput({ text: checkpointPrompt, source: "interactive" } as never), false);
	assert.equal(windows.admitPromptedCheckpointInput({ text: "Unrelated kickoff", source: "extension" } as never), false);
	assert.equal(windows.admitPromptedCheckpointInput({ text: checkpointPrompt, source: "extension" } as never), true,
		"manual checkpoint kickoff must bypass idle interception");
	assert.equal(windows.admitPromptedCheckpointInput({ text: checkpointPrompt, source: "extension" } as never), false);
	windows.beginPromptedManualCheckpointRun();
	windows.finishPromptedManualCheckpoint(ctx, true);
	let cancelledRollover = false;
	const cancelled = kickoff.prepareIdleInput(ctx, async () => { cancelledRollover = true; return true; });
	kickoff.reset();
	assert.deepEqual(await cancelled, { action: "handled" });
	await new Promise<void>((resolve) => setImmediate(resolve));
	assert.equal(cancelledRollover, false, "reset cancels preparation before its first asynchronous step");
	const state = { enabled: true, executionMode: "code", contextWindows: windows,
		contextTree: { handoff: { active: false } }, config: { ...DEFAULT_CODEX_CONVERSION_CONFIG,
			compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, continuity: "notes", historyStorage: "remote" } } };
	const { turnEnded } = createCodexTurnLifecycle(pi, { state } as never, {} as never, {} as never, {} as never, {} as never);
	const budgetCtx = { ...ctx, getContextUsage: () => ({ tokens: 232_000, contextWindow: 272_000, percent: 85.3 }) };
	const boundary = { entries: [], message: { role: "assistant", stopReason: "stop" }, toolResults: [] };
	assert.equal(await turnEnded(boundary as never, budgetCtx), undefined, "maintenance cannot restart a final reply");
	const reminder = await turnEnded({ ...boundary, message: { role: "assistant", stopReason: "toolUse" },
		toolResults: [{ role: "toolResult", toolCallId: "read", toolName: "read", content: [], isError: false, timestamp: 1 }],
	} as never, budgetCtx);
	assert.equal(reminder?.continue, true, "a completed tool step still receives its reminder");
});
