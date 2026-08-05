import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { captureActiveProviderSystemPrompt, rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
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

test("Code Mode relocates native freeform tools into Responses Lite", async () => {
	const rewritten = await rewriteCodexProviderRequest({ ...payload, model: "gpt-5.6" }, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, state(["litellm"])) as typeof payload;

	assert.equal("instructions" in rewritten, false);
	assert.equal((rewritten.input[0] as { type?: string }).type, "additional_tools");
	const liteTools = (rewritten.input[0] as unknown as { tools: Array<{ type: string; name: string; format: { syntax: string } }> }).tools;
	assert.equal(liteTools[0]?.type, "custom");
	assert.equal(liteTools[0]?.name, "exec");
	assert.equal(liteTools[0]?.format.syntax, "lark");
	assert.deepEqual((rewritten.input[1] as { content: unknown }).content, [{ type: "input_text", text: "Instructions" }]);
	assert.equal((rewritten.input[2] as { role: string }).role, "user");
});

test("captures downstream system-prompt additions from the final provider payload", () => {
	const adapterState = state();
	adapterState.activeProviderSystemPrompt = "Codex prompt before later extensions";
	const finalInstructions = "Codex prompt before later extensions\n\nDownstream machine identity";

	captureActiveProviderSystemPrompt({ ...payload, instructions: finalInstructions }, adapterState);

	assert.equal(adapterState.activeProviderSystemPrompt, finalInstructions);
});

test("voice preflight replaces stale instructions before Responses Lite relocation", async () => {
	const adapterState = state(["litellm"]);
	adapterState.voiceSystemPromptOverride = "Fresh voice delegation instructions";
	const rewritten = await rewriteCodexProviderRequest(payload, {
		model: { provider: "litellm", api: "openai-responses", id: "gpt-5.6" },
	} as never, adapterState) as typeof payload;

	assert.equal("instructions" in rewritten, false);
	assert.deepEqual((rewritten.input[1] as { content: unknown }).content, [
		{ type: "input_text", text: "Fresh voice delegation instructions" },
	]);
});

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
