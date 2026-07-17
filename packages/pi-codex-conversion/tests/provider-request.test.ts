import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
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
			beta: { codeMode: true, responsesLite: false },
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

test("Code Mode keeps raw exec tools in standard Responses requests", async () => {
	const rewritten = await rewriteCodexProviderRequest({ ...payload, model: "gpt-5.6" }, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"])) as typeof payload;

	assert.equal(rewritten.instructions, "Instructions");
	assert.equal(rewritten.tools[0]?.type, "custom");
	assert.equal(rewritten.tools[0]?.name, "exec");
	assert.equal((rewritten.tools[0] as unknown as { format: { syntax: string } }).format.syntax, "lark");
	assert.equal((rewritten.input[0] as { role: string }).role, "user");
});

test("inactive Code Mode strips custom-tool item IDs before function-tool replay", async () => {
	const disabled = state();
	disabled.config.beta.codeMode = false;
	const cases = [
		{
			adapterState: disabled,
			model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna" },
		},
		{
			adapterState: state(),
			model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
		},
	];

	for (const { adapterState, model } of cases) {
		const rewritten = await rewriteCodexProviderRequest({
			...payload,
			input: [{ type: "function_call", id: "ctc_02c506", call_id: "call_1", name: "exec", arguments: "{}" }],
		}, { model } as never, adapterState) as typeof payload;

		assert.deepEqual(rewritten.input[0], {
			type: "function_call",
			call_id: "call_1",
			name: "exec",
			arguments: "{}",
		});
	}
});
