import test from "node:test";
import assert from "node:assert/strict";
import {
	COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE,
	OPENAI_CODEX_COMPACTION_ENDPOINT_BUDGET_TOKENS,
	resolveNativeCompactionRequestBudget,
	shrinkNativeCompactionRequestForEndpoint,
} from "../src/adapter/compaction/request-shrink.ts";

test("GPT-5.6 Codex compaction uses the endpoint budget independently of model metadata", () => {
	assert.equal(resolveNativeCompactionRequestBudget({
		provider: "openai-codex",
		model: "gpt-5.6-luna",
		contextWindow: 272_000,
	}), OPENAI_CODEX_COMPACTION_ENDPOINT_BUDGET_TOKENS);

	assert.equal(resolveNativeCompactionRequestBudget({
		provider: "proxy",
		model: "gpt-5.6-luna",
		contextWindow: 100_000,
	}), 95_000);
});

test("compaction preserves full tool output until session usage exceeds the endpoint budget", async () => {
	const request = {
		model: "gpt-5.6-luna",
		input: [{ type: "function_call_output", call_id: "call", output: "full output" }],
	};
	const withinBudget = await shrinkNativeCompactionRequestForEndpoint(request, { budgetTokens: 1, tokensBefore: 1 });
	const overBudget = await shrinkNativeCompactionRequestForEndpoint(request, { budgetTokens: 1, tokensBefore: 2 });

	assert.equal(withinBudget.request, request);
	assert.equal(withinBudget.rewrittenOutputs, 0);
	assert.equal(overBudget.rewrittenOutputs, 1);
	assert.equal((overBudget.request.input[0] as { output?: unknown })?.output, COMPACTION_TRUNCATED_TOOL_OUTPUT_MESSAGE);
});
