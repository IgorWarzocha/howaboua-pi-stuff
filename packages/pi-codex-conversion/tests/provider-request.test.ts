import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { applyCodeModeProviderHeaders, rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function state(additionalProviders: string[] = []): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { codeMode: true },
			scope: { allProviders: "off", additionalProviders },
		},
	};
}

const payload = {
	model: "gpt-5.6-luna",
	instructions: "Instructions",
	input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
	tools: [{ type: "function", name: "exec", parameters: { type: "object", properties: { code: { type: "string" } } } }],
	parallel_tool_calls: true,
};

test("Responses Lite rewrites the GPT-5.6 alias for configured Responses providers", async () => {
	const rewritten = await rewriteCodexProviderRequest({ ...payload, model: "gpt-5.6" }, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"])) as typeof payload;

	assert.equal("instructions" in rewritten, false);
	assert.equal("tools" in rewritten, false);
	assert.equal(rewritten.parallel_tool_calls, false);
	assert.deepEqual(rewritten.input.slice(0, 2), [
		{ type: "additional_tools", role: "developer", tools: payload.tools },
		{ type: "message", role: "developer", content: [{ type: "input_text", text: "Instructions" }] },
	]);
});

test("Responses Lite marks requests for configured Responses providers", () => {
	const headers: Record<string, string> = {};
	applyCodeModeProviderHeaders(headers, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"]));

	assert.equal(headers["x-openai-internal-codex-responses-lite"], "true");
});
