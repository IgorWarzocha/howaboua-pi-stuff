import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildCompactionReasoning, injectPendingNativeWindowIntoPiCompactionRequest } from "../src/adapter/compaction/compaction.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import type { Model } from "@earendil-works/pi-ai";
import { serializeMessagesToCompactRequest, type NativeCompactionRequestBody } from "../src/adapter/compaction/serializer.ts";
import { COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE, shrinkNativeCompactionRequestForEndpoint } from "../src/adapter/compaction/request-shrink.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

test("native compaction requests use Codex-compatible compact payload shape", () => {
	const request = serializeMessagesToCompactRequest({
		model,
		messages: [],
		instructions: "compact",
	});

	assert.deepEqual(Object.keys(request).sort(), ["input", "instructions", "model"]);
});

test("native compaction shrinks tool outputs when request exceeds context window", async () => {
	const request: NativeCompactionRequestBody = {
		model: model.id,
		instructions: "compact",
		input: [
			{ role: "user", content: [{ type: "input_text", text: "keep" }] },
			{ type: "function_call", call_id: "call-1", name: "exec_command", arguments: "{}" },
			{ type: "function_call_output", call_id: "call-1", output: "x".repeat(800) },
			{ type: "function_call", call_id: "call-2", name: "exec_command", arguments: "{}" },
			{ type: "function_call_output", call_id: "call-2", output: "y".repeat(800) },
		],
	};

	const result = await shrinkNativeCompactionRequestForEndpoint(request, { contextWindow: 450 });

	assert.equal(result.rewrittenOutputs, 1);
	assert.equal((result.request.input[2] as { output: string }).output, COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE);
	assert.equal((result.request.input[4] as { output: string }).output, "y".repeat(800));
	assert.ok(result.estimatedTokensAfter < result.estimatedTokensBefore);
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
