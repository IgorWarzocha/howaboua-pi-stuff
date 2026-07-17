import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildCompactionReasoning, buildNativeCompactionRequest, injectPendingNativeWindowIntoPiCompactionRequest } from "../src/adapter/compaction/compaction.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import type { Model } from "@earendil-works/pi-ai";
import { serializeActiveSessionToCompactRequest, type NativeCompactionRequestBody } from "../src/adapter/compaction/serializer.ts";
import { COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE, shrinkNativeCompactionRequestForEndpoint } from "../src/adapter/compaction/request-shrink.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

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

	const request = serializeActiveSessionToCompactRequest({
		model,
		entries: [old, kept, compaction, tail] as never,
		leafId: "tail",
		instructions: "compact",
	});
	const serialized = JSON.stringify(request.input);

	assert.match(serialized, /Pi summary/);
	assert.match(serialized, /exact kept context/);
	assert.match(serialized, /exact live tail/);
	assert.doesNotMatch(serialized, /superseded old context/);
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
		summary: "shim",
		firstKeptEntryId: "tail",
		tokensBefore: 100,
		details: { compactedWindow: [{ type: "compaction", encrypted_content: "sealed" }] },
	} as never;
	const common = {
		model,
		compactionModel: model.id,
		branchEntries: [checkpoint, tailEntry],
		allEntries: [checkpoint, tailEntry],
		leafId: "tail",
		instructions: "compact",
		requestOptions: {},
	};

	const matching = buildNativeCompactionRequest({
		...common,
		latestNativeCompaction: { ok: true, entry: checkpoint, index: 0, latestCompactionIndex: 0 },
	});
	assert.equal(matching?.compactedKeptWindow, false);
	assert.equal((matching?.request.input[0] as { encrypted_content: string }).encrypted_content, "sealed");
	assert.match(JSON.stringify(matching?.request.input), /exact live tail/);

	const mismatched = buildNativeCompactionRequest({
		...common,
		latestNativeCompaction: { ok: false, reason: "latest-native-compaction-mismatch", latestCompactionIndex: 0, latestCompaction: checkpoint },
	});
	assert.equal(mismatched?.compactedKeptWindow, true);
	assert.doesNotMatch(JSON.stringify(mismatched?.request.input), /sealed/);
	assert.match(JSON.stringify(mismatched?.request.input), /exact live tail/);
});

test("native compaction shrinks tool outputs when request exceeds context window", async () => {
	const request: NativeCompactionRequestBody = {
		model: model.id,
		instructions: "compact",
		input: [
			{ role: "user", content: [{ type: "input_text", text: "keep" }] },
			{ type: "function_call", call_id: "call-1", name: "exec_command", arguments: "{}" },
			{ type: "function_call_output", call_id: "call-1", output: "x".repeat(3000) },
			{ type: "function_call", call_id: "call-2", name: "exec_command", arguments: "{}" },
			{ type: "function_call_output", call_id: "call-2", output: "y".repeat(3000) },
		],
	};

	const result = await shrinkNativeCompactionRequestForEndpoint(request, { contextWindow: 450 });

	assert.equal(result.rewrittenOutputs, 1);
	assert.equal(result.budgetTokens, 427);
	assert.equal((result.request.input[2] as { output: string }).output, "x".repeat(3000));
	assert.equal((result.request.input[4] as { output: string }).output, COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE);
	assert.ok(result.estimatedTokensAfter < result.estimatedTokensBefore);
	assert.ok(result.estimatedTokensAfter > result.budgetTokens!);
});

test("native compaction trims Codex custom and tool-search frontier outputs", async () => {
	const cases = [
		{
			item: { type: "custom_tool_call_output", call_id: "custom", output: "large output" },
			assertRewritten: (item: Record<string, unknown>) => assert.equal(item["output"], COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE),
		},
		{
			item: { type: "tool_search_output", call_id: "search", tools: [{ type: "function", name: "example" }] },
			assertRewritten: (item: Record<string, unknown>) => assert.deepEqual(item["tools"], []),
		},
	];

	for (const testCase of cases) {
		const result = await shrinkNativeCompactionRequestForEndpoint(
			{ model: model.id, input: [testCase.item as never] },
			{ contextWindow: 1 },
		);
		assert.equal(result.rewrittenOutputs, 1);
		testCase.assertRewritten(result.request.input[0] as unknown as Record<string, unknown>);
	}
});

test("injects pending native compacted window into Pi compaction summarization payload", async () => {
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }) },
	} as any;
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
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

	const rewritten = await injectPendingNativeWindowIntoPiCompactionRequest(payload, ctx, state) as typeof payload;
	assert.deepEqual(rewritten.input.map((item) => (item as { type?: string; role?: string }).type ?? (item as { role?: string }).role), ["developer", "compaction_summary", "user"]);
	assert.equal(state.pendingPiCompactionNativeWindow, undefined);
});

test("explicit compaction reasoning is clamped against the compaction model", () => {
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, compactionReasoning: "max" },
		},
	};
	const chatModel = { ...model, id: "gpt-5.4", thinkingLevelMap: { high: "high" } } as Model<any>;
	const compactionModel = { ...model, id: "gpt-5.6-luna", thinkingLevelMap: { max: "max" }, contextWindow: 373_000 } as Model<any>;
	const ctx = { model: chatModel } as never;

	assert.deepEqual(buildCompactionReasoning({ getThinkingLevel: () => "high" }, ctx, state, compactionModel), {
		effort: "max",
		summary: "auto",
	});
});
