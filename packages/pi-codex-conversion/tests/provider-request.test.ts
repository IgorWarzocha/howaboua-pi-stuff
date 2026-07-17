import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

function state(additionalProviders: string[] = [], responsesLite = false): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		codexTurnState: createCodexTurnState(),
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			beta: { codeMode: true, responsesLite },
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

test("Code Mode preserves backend item IDs while replaying exec history", async () => {
	const rewritten = await rewriteCodexProviderRequest({
		...payload,
		model: "gpt-5.6",
		input: [
			{ type: "function_call", id: "ctc_02c506", call_id: "call_1", name: "exec", arguments: JSON.stringify({ code: "text(42);" }) },
			{ type: "function_call_output", call_id: "call_1", output: "42" },
		],
	}, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"])) as typeof payload;

	assert.deepEqual(rewritten.input, [
		{ type: "custom_tool_call", id: "ctc_02c506", call_id: "call_1", name: "exec", input: "text(42);" },
		{ type: "custom_tool_call_output", call_id: "call_1", output: "42" },
	]);
});

test("Code Mode leaves a rewritten request for another model untouched", async () => {
	const rewritten = await rewriteCodexProviderRequest({ ...payload, model: "gpt-5.5" }, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"], true)) as typeof payload;

	assert.equal(rewritten.model, "gpt-5.5");
	assert.equal(rewritten.tools[0]?.type, "function");
	assert.equal(rewritten.instructions, "Instructions");
});

test("turning Code Mode off safely replays stored custom-tool history", async () => {
	const adapterState = state();
	adapterState.config.beta.codeMode = false;
	const rewritten = await rewriteCodexProviderRequest({
		...payload,
		input: [
			{ type: "function_call", id: "ctc_02c506", call_id: "call_1", name: "exec", arguments: JSON.stringify({ code: "text(42);" }) },
			{ type: "function_call_output", call_id: "call_1", output: "42" },
		],
	}, {
		model: { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.6-luna" },
	} as never, adapterState) as typeof payload;

	assert.deepEqual(rewritten.input[0], {
		type: "function_call",
		call_id: "call_1",
		name: "exec",
		arguments: JSON.stringify({ code: "text(42);" }),
	});
});

test("stored Code Mode history is sanitized after its provider leaves adapter scope", async () => {
	const rewritten = await rewriteCodexProviderRequest({
		...payload,
		input: [{ type: "function_call", id: "ctc_02c506", call_id: "call_1", name: "exec", arguments: "{}" }],
	}, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state()) as typeof payload;

	assert.deepEqual(rewritten.input[0], {
		type: "function_call",
		call_id: "call_1",
		name: "exec",
		arguments: "{}",
	});
});

test("Responses Lite rewrites the GPT-5.6 alias when enabled for configured providers", async () => {
	const rewritten = await rewriteCodexProviderRequest({ ...payload, model: "gpt-5.6" }, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"], true)) as typeof payload;

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
