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
			beta: { codeMode: true, responsesLite: true },
			scope: { allProviders: "off", additionalProviders },
		},
	};
}

const payload = {
	model: "gpt-5.6-luna",
	instructions: "Instructions",
	input: [{ role: "user", content: [{ type: "input_text", text: "Hello" }] }],
	tools: [{ type: "custom", name: "exec", format: { type: "grammar", syntax: "lark", definition: "start: /.+/" } }],
	parallel_tool_calls: true,
};

test("voice-only mode does not rewrite provider requests", async () => {
	const voiceOnly = state(["litellm"]);
	voiceOnly.config.voiceFeaturesOnly = true;
	const voiceOnlyPayload = {
		...payload,
		input: [{ type: "function_call", id: "ctc_02c506", call_id: "call_1", name: "exec", arguments: "{}" }],
	};
	const rewritten = await rewriteCodexProviderRequest(structuredClone(voiceOnlyPayload), {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, voiceOnly);

	assert.equal(rewritten, undefined);
});
