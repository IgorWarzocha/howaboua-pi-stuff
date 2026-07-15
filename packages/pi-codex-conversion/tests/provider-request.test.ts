import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { applyProxiedCodeModeProviderHeaders, rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
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
	const additionalTools = rewritten.input[0] as unknown as {
		type: string;
		tools: Array<{ type: string; name: string; format: { type: string; syntax: string; definition: string } }>;
	};
	assert.equal(additionalTools.type, "additional_tools");
	assert.equal(additionalTools.tools[0]?.type, "custom");
	assert.equal(additionalTools.tools[0]?.name, "exec");
	assert.equal(additionalTools.tools[0]?.format.syntax, "lark");
	assert.match(additionalTools.tools[0]?.format.definition ?? "", /pragma_source/);
	assert.deepEqual(rewritten.input[1], {
		type: "message",
		role: "developer",
		content: [{ type: "input_text", text: "Instructions" }],
	});
});

test("Responses Lite marks requests for configured Responses providers", () => {
	const headers: Record<string, string | null> = {
		"X-OpenAI-Internal-Codex-Responses-Lite": "false",
	};
	applyProxiedCodeModeProviderHeaders(headers, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"]));

	assert.equal(headers["x-openai-internal-codex-responses-lite"], "true");
	assert.equal(headers["X-OpenAI-Internal-Codex-Responses-Lite"], null);
});

test("Responses Lite headers stay off built-in and extras-only requests", () => {
	const builtInHeaders: Record<string, string | null> = {};
	applyProxiedCodeModeProviderHeaders(builtInHeaders, {
		model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-sol" },
	} as never, state());
	assert.deepEqual(builtInHeaders, {});

	const extrasOnlyState = state(["litellm"]);
	extrasOnlyState.config = {
		...extrasOnlyState.config,
		tools: { ...extrasOnlyState.config.tools, applyPatchOnly: true },
	};
	const extrasOnlyHeaders: Record<string, string | null> = {};
	applyProxiedCodeModeProviderHeaders(extrasOnlyHeaders, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, extrasOnlyState);
	assert.deepEqual(extrasOnlyHeaders, {});
});
