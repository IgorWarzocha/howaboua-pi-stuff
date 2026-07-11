import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function state(responsesLite: boolean): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { responsesLite },
		},
	};
}

const ctx = {
	model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna" },
} as never;

const payload = {
	model: "gpt-5.6-luna",
	instructions: "Instructions",
	input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
	tools: [{ type: "function", name: "exec_command" }],
	parallel_tool_calls: true,
};

test("provider request rewriting leaves classic Responses as the default", async () => {
	const rewritten = await rewriteCodexProviderRequest(payload, ctx, state(false)) as typeof payload;
	assert.equal(rewritten.instructions, "Instructions");
	assert.equal(rewritten.tools?.[0]?.name, "exec_command");
	assert.equal(rewritten.parallel_tool_calls, true);
});

test("provider request rewriting applies Responses Lite after adapter replay work", async () => {
	const rewritten = await rewriteCodexProviderRequest(payload, ctx, state(true)) as Record<string, any>;
	assert.equal("instructions" in rewritten, false);
	assert.equal("tools" in rewritten, false);
	assert.equal(rewritten["parallel_tool_calls"], false);
	assert.equal(rewritten["input"][0].type, "additional_tools");
	assert.equal(rewritten["input"][1].role, "developer");
	assert.equal(rewritten["reasoning"].context, "all_turns");
});

test("Responses Lite never rewrites configured non-OpenAI-Codex providers", async () => {
	const adapterState = state(true);
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
