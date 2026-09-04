import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_COMPACTION_SETTINGS, type SessionBeforeCompactEvent } from "@earendil-works/pi-coding-agent";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import { CodexContextTreeCoordinator } from "../src/context-management/tree-coordinator.ts";
import { buildNativeCompactionInput, injectPendingNativeWindowIntoPiCompactionRequest, resolveOpaqueNativeCompactionFallbackEntry } from "../src/adapter/compaction/compaction.ts";
import { runPortablePiCompaction } from "../src/adapter/compaction/portable-summary.ts";
import { hasPortableNativeCompactionSummary, NATIVE_COMPACTION_SHIM_SUMMARY, NATIVE_COMPACTION_STRATEGY, type NativeCompactionEntry } from "../src/adapter/compaction/types.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { createAssistantMessageEventStream, type AssistantMessage, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";
import { serializeActiveSessionToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	type CodexDeveloperMessageDetails,
} from "../src/developer-messages.ts";
import {
	REALTIME_DELEGATION_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "../src/voice/message-types.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

function summaryMessage(
	requestModel: Model<any>,
	text: string,
): AssistantMessage {
	return {
		role: "assistant",
		content: text ? [{ type: "text", text }] : [],
		api: requestModel.api,
		provider: requestModel.provider,
		model: requestModel.id,
		usage: {
			input: text ? 10 : 0,
			output: text ? 4 : 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: text ? 14 : 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "stop",
		timestamp: 1,
	};
}

function summaryStream(message: AssistantMessage) {
	const stream = createAssistantMessageEventStream();
	stream.push({ type: "done", reason: "stop", message });
	stream.end();
	return stream;
}

test("first native compaction sends the full active Pi context", () => {
	const entry = (id: string, parentId: string | null, content: string) => ({
		type: "message",
		id,
		parentId,
		timestamp: new Date(1).toISOString(),
		message: { role: "user", content, timestamp: 1 },
	});
	const old = entry("old", null, "superseded old context");
	const kept = entry("kept", "old", "exact kept context");
	const compaction = {
		type: "compaction",
		id: "pi-compaction",
		parentId: "kept",
		timestamp: new Date(2).toISOString(),
		summary: "Pi summary",
		firstKeptEntryId: "kept",
		tokensBefore: 100,
	};
	const tail = entry("tail", "pi-compaction", "exact live tail");

	const input = serializeActiveSessionToResponsesInput({
		model,
		entries: [old, kept, compaction, tail] as never,
		leafId: "tail",
	});
	const serialized = JSON.stringify(input);

	assert.match(serialized, /Pi summary/);
	assert.match(serialized, /exact kept context/);
	assert.match(serialized, /exact live tail/);
	assert.doesNotMatch(serialized, /superseded old context/);
});

test("native compaction excludes voice-only chatter but preserves Pi delegations", () => {
	const customEntry = (
		id: string,
		parentId: string | null,
		customType: string,
		content: string,
		details: unknown = {},
	) => ({
		type: "custom_message",
		id,
		parentId,
		timestamp: new Date(1).toISOString(),
		customType,
		content,
		display: false,
		details,
	});
	const chatter = customEntry(
		"chatter",
		null,
		REALTIME_VOICE_MESSAGE_TYPE,
		"voice-only conversation",
	);
	const delegation = customEntry(
		"delegation",
		"chatter",
		REALTIME_DELEGATION_MESSAGE_TYPE,
		"Pi-visible delegation",
	);
	const developer = customEntry(
		"developer",
		"delegation",
		CODEX_DEVELOPER_MESSAGE_TYPE,
		"Provider-level guidance",
		{ protocol: 1, id: "developer-1" } satisfies CodexDeveloperMessageDetails,
	);

	const input = serializeActiveSessionToResponsesInput({
		model,
		entries: [chatter, delegation, developer] as never,
		leafId: "developer",
	});
	const serialized = JSON.stringify(input);

	assert.doesNotMatch(serialized, /voice-only conversation/);
	assert.match(serialized, /Pi-visible delegation/);
	assert.deepEqual(input.at(-1), {
		role: "developer",
		content: [{ type: "input_text", text: "Provider-level guidance" }],
	});
});

test("native compaction request routing reuses only the latest matching checkpoint", () => {
	const tailEntry = {
		type: "message",
		id: "tail",
		parentId: "checkpoint",
		timestamp: new Date(2).toISOString(),
		message: { role: "user", content: "exact live tail", timestamp: 2 },
	} as never;
	const checkpoint = {
		type: "compaction",
		id: "checkpoint",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		summary: NATIVE_COMPACTION_SHIM_SUMMARY,
		firstKeptEntryId: "tail",
		tokensBefore: 100,
		details: {
			strategy: NATIVE_COMPACTION_STRATEGY,
			provider: model.provider,
			api: model.api,
			model: model.id,
			baseUrl: model.baseUrl,
			compactedWindow: [{ type: "compaction", encrypted_content: "sealed" }],
			createdAt: new Date(1).toISOString(),
		},
	} as NativeCompactionEntry;
	const common = {
		model,
		branchEntries: [checkpoint, tailEntry],
		allEntries: [checkpoint, tailEntry],
		leafId: "tail",
	};

	const matching = buildNativeCompactionInput({
		...common,
		latestNativeCompaction: { ok: true, entry: checkpoint, index: 0, latestCompactionIndex: 0 },
	});
	assert.equal(matching?.compactedKeptWindow, false);
	assert.equal((matching?.input[0] as { encrypted_content: string }).encrypted_content, "sealed");
	assert.match(JSON.stringify(matching?.input), /exact live tail/);
	assert.equal(hasPortableNativeCompactionSummary(checkpoint), false);

	const portableCheckpoint: NativeCompactionEntry = { ...checkpoint, summary: "Readable cumulative Pi summary" };
	const mismatched = buildNativeCompactionInput({
		...common,
		branchEntries: [portableCheckpoint, tailEntry],
		allEntries: [portableCheckpoint, tailEntry],
		latestNativeCompaction: { ok: false, reason: "latest-native-compaction-mismatch", latestCompactionIndex: 0, latestCompaction: portableCheckpoint },
	});
	assert.equal(hasPortableNativeCompactionSummary(portableCheckpoint), true);
	assert.equal(mismatched?.compactedKeptWindow, true);
	assert.doesNotMatch(JSON.stringify(mismatched?.input), /sealed/);
	assert.match(JSON.stringify(mismatched?.input), /Readable cumulative Pi summary/);
	assert.match(JSON.stringify(mismatched?.input), /exact live tail/);
	const runtime = { provider: model.provider, api: model.api, baseUrl: model.baseUrl };
	assert.equal(resolveOpaqueNativeCompactionFallbackEntry([checkpoint], runtime)?.id, checkpoint.id);
	const portableOtherLaneDetails = portableCheckpoint.details;
	assert.ok(portableOtherLaneDetails);
	const portableOtherLane: NativeCompactionEntry = {
		...portableCheckpoint,
		id: "portable-other-lane",
		details: { ...portableOtherLaneDetails, provider: "other-codex-provider" },
	};
	assert.equal(resolveOpaqueNativeCompactionFallbackEntry([checkpoint, portableOtherLane], runtime), undefined);
});

test("portable Pi compaction consumes opaque checkpoints on an isolated summary lane", async () => {
	const contextWindows = new CodexContextWindowManager();
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }) },
	} as any;
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		executionMode: DEFAULT_CODEX_CONVERSION_CONFIG.executionMode,
		codexTurnState: createCodexTurnState(),
		developerMessages: new CodexDeveloperMessageBridge(),
		contextWindows,
		contextTree: new CodexContextTreeCoordinator(contextWindows),
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, responsesCompaction: true } },
		pendingPiCompactionNativeWindow: {
			window: [{ type: "compaction_summary", encrypted_content: "sealed" }],
			provider: model.provider,
			api: model.api,
			baseUrl: model.baseUrl as string,
			sessionId: "session-1",
		},
	};
	const payload = {
		model: model.id,
		input: [
			{ role: "developer", content: "You are a context summarization assistant. ONLY output the structured summary." },
			{ role: "user", content: [{ type: "input_text", text: "<conversation>hello</conversation>" }] },
		],
	};

	const portableEvent = {
		type: "session_before_compact",
		preparation: {
			firstKeptEntryId: "tail",
			messagesToSummarize: [{ role: "user", content: "new work", timestamp: 1 }],
			turnPrefixMessages: [],
			isSplitTurn: false,
			tokensBefore: 100,
			previousSummary: "Earlier readable state",
			fileOps: { read: new Set<string>(), written: new Set<string>(), edited: new Set<string>() },
			settings: DEFAULT_COMPACTION_SETTINGS,
		},
		branchEntries: [],
		customInstructions: "Keep exact decisions",
		reason: "manual",
		willRetry: false,
		signal: new AbortController().signal,
	} satisfies SessionBeforeCompactEvent;
	let summaryRequest: { context: string; options?: SimpleStreamOptions | undefined } | undefined;
	const portable = await runPortablePiCompaction(portableEvent, {
		model,
		thinkingLevel: "high",
		onPayload: async (requestPayload) => (
			await injectPendingNativeWindowIntoPiCompactionRequest(requestPayload, ctx, state)
		) ?? requestPayload,
		stream: async (requestModel, context, options) => {
			summaryRequest = { context: JSON.stringify(context), options };
			const portablePayload = await options?.onPayload?.(payload, requestModel) as typeof payload;
			assert.deepEqual(portablePayload.input.map((item) => (item as { type?: string; role?: string }).type ?? (item as { role?: string }).role), ["developer", "compaction_summary", "user"]);
			return summaryStream(summaryMessage(requestModel, "Readable cumulative summary"));
		},
	});
	assert.equal(portable.summary, "Readable cumulative summary");
	assert.match(summaryRequest?.context ?? "", /Earlier readable state/);
	assert.match(summaryRequest?.context ?? "", /Keep exact decisions/);
	assert.equal(summaryRequest?.options?.cacheRetention, "none");
	assert.equal(summaryRequest?.options?.transport, "sse");
	assert.notEqual(summaryRequest?.options?.sessionId, "session-1");
	assert.ok(summaryRequest?.options?.sessionId);
	assert.equal(state.pendingPiCompactionNativeWindow, undefined);
});
