import test from "node:test";
import assert from "node:assert/strict";
import { buildSessionContext, DEFAULT_COMPACTION_SETTINGS, SessionManager, type ExtensionAPI, type ExtensionContext, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type Api, type AssistantMessage, type Model } from "@earendil-works/pi-ai";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { handleCodexSessionBeforeCompact, rewriteCodexCompactedProviderRequest } from "../src/adapter/compaction/compaction.ts";
import { createNativeCompactionDetails, NATIVE_COMPACTION_SHIM_SUMMARY } from "../src/adapter/compaction/types.ts";
import { projectPiCompactionEvent } from "../src/adapter/compaction/portable-summary.ts";
import { serializeActiveSessionToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { createContextWindowMessage } from "../src/context-management/messages.ts";
import { createTreeArchiveManifest, TREE_ARCHIVE_ENTRY_TYPE } from "../src/context-management/tree-archive.ts";
import { projectTreeCheckpointBranch } from "../src/context-management/tree-checkpoint.ts";
import { CodexContextWindowManager, projectContextWindowBranch } from "../src/context-management/window-manager.ts";
import { CodexContextWindowKickoff } from "../src/context-management/window-kickoff.ts";
import { CodexContextTreeCoordinator } from "../src/context-management/tree-coordinator.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { sseResponse } from "./openai-codex-test-support.ts";

// Pi does not export its preparation function, but the hook receives its exact output.
const { prepareCompaction } = await import(new URL("./core/compaction/compaction.js", import.meta.resolve("@earendil-works/pi-coding-agent")).href);
const model: Model<"openai-responses"> = {
	id: "gpt-5.4", name: "Checkpoint test", provider: "checkpoint-test", api: "openai-responses", baseUrl: "https://checkpoint.invalid/v1",
	reasoning: false, input: ["text"], contextWindow: 100_000, maxTokens: 10_000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const assistant: AssistantMessage = {
	role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
	stopReason: "stop", timestamp: 2, responseId: "native-response",
	usage: { input: 10, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 11,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
};

function fixture(currentModel: Model<Api> = model) {
	const session = SessionManager.inMemory("/repo");
	const contextWindows = new CodexContextWindowManager(async () => undefined);
	const contextKickoff = new CodexContextWindowKickoff(contextWindows);
	const state: AdapterState = {
		enabled: true, cwd: "/repo", promptSkills: [], executionMode: "normal",
		config: { ...structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG), executionMode: "normal",
			scope: { allProviders: "off", additionalProviders: [currentModel.provider] } },
		codexTurnState: createCodexTurnState(), developerMessages: new CodexDeveloperMessageBridge(),
		contextWindows, contextKickoff, contextTree: new CodexContextTreeCoordinator(contextWindows, contextKickoff),
	};
	const notices: string[] = [];
	const ctx = {
		model: currentModel, sessionManager: session, getSystemPrompt: () => "Continue the work", thinkingLevel: "off",
		ui: { notify: (message: string) => notices.push(message) },
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "test-key" }),
			getRegisteredProviderConfig: () => ({ api: currentModel.api, streamSimple: (_model: unknown, _context: unknown, options: { onOutputItemDone: (item: unknown) => void }) => {
				options.onOutputItemDone({ type: "compaction", encrypted_content: "next-sealed" });
				const stream = createAssistantMessageEventStream();
				stream.push({ type: "done", reason: "stop", message: assistant });
				stream.end();
				return stream;
			} }),
		},
	} as unknown as ExtensionContext;
	const pi = { getAllTools: () => [], getActiveTools: () => [], getThinkingLevel: () => "off",
		sendMessage: (message: ReturnType<typeof createContextWindowMessage>) => session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details),
	} as unknown as ExtensionAPI;
	const user = (text: string) => session.appendMessage({ role: "user", content: text, timestamp: 1 });
	const window = (number: number, trim = false) => {
		const message = createContextWindowMessage(`Window ${number}`, "window", {
			firstWindowId: "window-0", currentWindowId: `window-${number}`, windowNumber: number,
			...(number > 0 ? { previousWindowId: `window-${number - 1}` } : {}),
		}, trim);
		return session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
	};
	return { session, ctx, pi, state, user, window, notices };
}

function archive(f: ReturnType<typeof fixture>) {
	const boundary = f.window(0);
	const kept = f.user("ARCHIVED-KEPT");
	f.session.appendCompaction("AUTHORITATIVE-CHECKPOINT", kept, 80_000);
	f.user("ARCHIVED-TAIL");
	const checkpoint = f.session.getBranch().find((entry) => entry.type === "compaction")!;
	const summaryId = f.session.branchWithSummary(null, "SEARCH-ONLY-ARCHIVE");
	const summary = f.session.getEntry(summaryId);
	assert.equal(summary?.type, "branch_summary");
	if (summary?.type !== "branch_summary") throw new Error("Missing archive summary");
	f.session.appendCustomEntry(TREE_ARCHIVE_ENTRY_TYPE, createTreeArchiveManifest("window-0", boundary, summary, checkpoint.id));
	f.window(1);
	f.user("RECENT-KEPT");
}

test("Pi and Both summarize the authoritative Tree checkpoint with physical kept-entry IDs", async () => {
	const originalFetch = globalThis.fetch;
	const observations: Array<{ method: string; summary: unknown; request: string; notices: string[] }> = [];
	try {
		for (const method of ["pi", "both"] as const) {
			const f = fixture();
			archive(f);
			f.state.config.compaction = { ...f.state.config.compaction, continuity: "notes-and-compaction", historyStorage: "tree", method };
			const branchEntries = f.session.getBranch();
			const preparation: SessionBeforeCompactEvent["preparation"] = prepareCompaction(branchEntries, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 });
			assert.equal(preparation.previousSummary, undefined);
			assert.match(JSON.stringify(preparation), /SEARCH-ONLY-ARCHIVE/);
			let request = "";
			globalThis.fetch = async (_input, init) => {
				request += String(init?.body);
				return sseResponse([
					{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_summary", role: "assistant", content: [] } },
					{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } },
					{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "New cumulative summary" },
					{ type: "response.completed", response: { id: "pi-summary", status: "completed", usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 } } },
				]);
			};
			const result = await handleCodexSessionBeforeCompact({ type: "session_before_compact", preparation, branchEntries,
				reason: "manual", willRetry: false, customInstructions: "Keep decisions", signal: new AbortController().signal }, f.ctx, f.state, f.pi);
			observations.push({ method, summary: result?.compaction?.summary, request, notices: f.notices });
			if (result?.compaction) {
				const c = result.compaction;
				assert.ok(branchEntries.some((entry) => entry.id === c.firstKeptEntryId));
				f.session.appendCompaction(c.summary, c.firstKeptEntryId, c.tokensBefore, c.details);
				assert.match(JSON.stringify(f.session.buildSessionContext().messages), /RECENT-KEPT/);
			}
		}
		for (const result of observations) {
			assert.equal(result.summary, "New cumulative summary", JSON.stringify(observations));
			assert.match(result.request, /AUTHORITATIVE-CHECKPOINT/, result.method);
			assert.match(result.request, /ARCHIVED-KEPT/, result.method);
			assert.match(result.request, /ARCHIVED-TAIL/, result.method);
			assert.doesNotMatch(result.request, /SEARCH-ONLY-ARCHIVE/, result.method);
		}
	} finally { globalThis.fetch = originalFetch; }
});

test("an explicit notes-only trim supersedes a valid Tree archive without changing its ancestry", () => {
	const f = fixture();
	archive(f);
	f.window(2, true);
	f.user("NEW-WINDOW-ONLY");
	const active = f.session.getBranch();
	const all = f.session.getEntries();
	const stored = JSON.stringify(all);
	const projected = projectTreeCheckpointBranch(active, all);
	assert.match(JSON.stringify(projected), /AUTHORITATIVE-CHECKPOINT/);
	for (const mode of ["tree", "local", "remote", "off"] as const) {
		const messages = f.state.contextWindows.project(buildSessionContext([...projected]).messages, mode, active, all);
		assert.match(JSON.stringify(messages), /NEW-WINDOW-ONLY/);
		assert.doesNotMatch(JSON.stringify(messages), /AUTHORITATIVE-CHECKPOINT|ARCHIVED-|RECENT-KEPT|SEARCH-ONLY-ARCHIVE/, mode);
	}
	const preparation: SessionBeforeCompactEvent["preparation"] = prepareCompaction(active, { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 1 });
	const summary = projectPiCompactionEvent({ type: "session_before_compact", preparation, branchEntries: active,
		reason: "overflow", willRetry: true, signal: new AbortController().signal }, projectContextWindowBranch([...projected]));
	assert.equal(summary.preparation.previousSummary, undefined, "a later overflow cannot resurrect retired context");
	assert.doesNotMatch(JSON.stringify(summary.preparation), /AUTHORITATIVE-CHECKPOINT|ARCHIVED-|RECENT-KEPT|SEARCH-ONLY-ARCHIVE/);
	assert.equal(JSON.stringify(all), stored);
});

test("native replay follows checkpoint lifetime rather than continuity or method settings", async () => {
	const replayModel = { ...model, provider: "openai-codex", api: "openai-codex-responses" as const };
	const f = fixture(replayModel);
	const kept = f.user("Native retained turn");
	f.session.appendCompaction(NATIVE_COMPACTION_SHIM_SUMMARY, kept, 80_000, createNativeCompactionDetails({
		provider: replayModel.provider, api: replayModel.api, model: replayModel.id, baseUrl: replayModel.baseUrl,
		compactedWindow: [{ type: "compaction", encrypted_content: "retired-sealed" }], createdAt: new Date(1).toISOString(),
	}));
	const tail = f.user("Tail to convert");
	const payload = () => ({ model: replayModel.id, instructions: "", input: serializeActiveSessionToResponsesInput({
		model: replayModel, entries: f.session.getEntries(), leafId: f.session.getLeafId(),
	}) });
	f.state.config.compaction.method = "pi";
	for (const continuity of ["compaction", "notes", "notes-and-compaction"] as const) {
		for (const historyStorage of ["local", "tree", "remote"] as const) {
			f.state.config.compaction = { ...f.state.config.compaction, continuity, historyStorage };
			f.state.contextWindows.ensureInitialized(f.pi, f.ctx, continuity !== "compaction");
			const rewritten = JSON.stringify(await rewriteCodexCompactedProviderRequest(payload(), f.ctx, f.state));
			assert.match(rewritten, /retired-sealed/, `${continuity}/${historyStorage}`);
			assert.match(rewritten, /Tail to convert/);
		}
	}
	const liveLeaf = f.session.getLeafId();
	assert.ok(liveLeaf);
	f.state.config.compaction.continuity = "notes";
	await f.state.contextWindows.startNewWindow(f.pi, f.ctx, { mode: "remote", trimPreviousWindow: true });
	assert.equal(await rewriteCodexCompactedProviderRequest(payload(), f.ctx, f.state), undefined, "an explicit notes-only rollover retires replay");
	f.session.branch(liveLeaf);
	f.state.contextWindows.restore(f.session.getBranch());
	f.state.config.compaction.continuity = "compaction";
	f.session.appendCompaction("READABLE-PI-CONVERSION", tail, 90_000);
	f.user("Current work");
	for (const method of ["pi", "v2", "both"] as const) {
		f.state.config.compaction.method = method;
		const original = payload();
		const rewritten = await rewriteCodexCompactedProviderRequest(original, f.ctx, f.state);
		assert.doesNotMatch(JSON.stringify(rewritten ?? original), /retired-sealed/, method);
		assert.match(JSON.stringify(rewritten ?? original), /READABLE-PI-CONVERSION/);
	}
});
