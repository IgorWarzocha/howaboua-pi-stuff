import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function state(): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { responsesLite: true },
		},
	};
}

const payload = {
	model: "gpt-5.6-luna",
	instructions: "Instructions",
	input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
	tools: [{ type: "function", name: "exec_command" }],
	parallel_tool_calls: true,
};

test("Responses Lite never rewrites configured non-OpenAI-Codex providers", async () => {
	const adapterState = state();
	adapterState.config = {
		...adapterState.config,
		scope: { allProviders: "off", additionalProviders: ["my-provider"] },
	};
	const rewritten = await rewriteCodexProviderRequest(payload, {
		model: { provider: "my-provider", api: "openai-codex-responses", id: "gpt-5.6-luna" },
	} as never, adapterState) as typeof payload;
	assert.equal(rewritten.instructions, "Instructions");
	assert.equal(rewritten.parallel_tool_calls, true);
});
