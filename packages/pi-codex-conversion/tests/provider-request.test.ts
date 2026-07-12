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
			beta: { codeMode: true },
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

test("GPT-5.6 Code Mode sends only freeform exec and function wait", async () => {
	const rewritten = await rewriteCodexProviderRequest({
		...payload,
		tools: [
			{ type: "function", name: "exec", description: "Compose tools", parameters: { type: "object" } },
			{ type: "function", name: "wait", parameters: { type: "object" } },
		],
	}, {
		model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna" },
	} as never, state()) as { input: Array<Record<string, unknown>>; tools?: unknown };

	assert.equal(rewritten.tools, undefined);
	const additionalTools = rewritten.input[0]?.["tools"] as Array<Record<string, unknown>>;
	assert.deepEqual(additionalTools.map((tool) => [tool["type"], tool["name"]]), [["custom", "exec"], ["function", "wait"]]);
	assert.equal("parameters" in additionalTools[0]!, false);
	const format = additionalTools[0]?.["format"] as Record<string, unknown>;
	assert.equal(format["type"], "grammar");
	assert.equal(format["syntax"], "lark");
	assert.match(String(format["definition"]), /plain_source/);
});
