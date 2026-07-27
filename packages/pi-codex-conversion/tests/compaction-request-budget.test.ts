import test from "node:test";
import assert from "node:assert/strict";
import {
	OPENAI_CODEX_COMPACTION_ENDPOINT_BUDGET_TOKENS,
	resolveNativeCompactionRequestBudget,
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
