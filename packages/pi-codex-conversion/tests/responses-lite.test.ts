import test from "node:test";
import assert from "node:assert/strict";
import { applyResponsesLiteRequest, applyResponsesLiteWebSocketMetadata, supportsResponsesLiteModel } from "../src/providers/openai-codex/responses-lite.ts";

test("Responses Lite is limited to the GPT-5.6 Codex family", () => {
	assert.equal(supportsResponsesLiteModel("gpt-5.6-luna"), true);
	assert.equal(supportsResponsesLiteModel("openai/gpt-5.6-terra"), true);
	assert.equal(supportsResponsesLiteModel("gpt-5.6-sol"), true);
	assert.equal(supportsResponsesLiteModel("gpt-5.5"), false);
	assert.equal(supportsResponsesLiteModel("gpt-5.6"), false);
});

test("Responses Lite moves instructions and tools into input and prepares images", () => {
	const body = applyResponsesLiteRequest({
		model: "gpt-5.6-luna",
		instructions: "Be useful",
		tools: [{ type: "function", name: "exec_command" }],
		parallel_tool_calls: true,
		reasoning: { effort: "medium", summary: "auto" },
		input: [
			{ type: "message", role: "user", content: [
				{ type: "input_image", image_url: "data:image/png;base64,AAA", detail: "original" },
				{ type: "input_image", image_url: "https://example.com/image.png", detail: "high" },
			] },
		],
	});

	assert.equal("instructions" in body, false);
	assert.equal("tools" in body, false);
	assert.equal(body.parallel_tool_calls, false);
	assert.deepEqual(body.reasoning, { effort: "medium", summary: "auto", context: "all_turns" });
	assert.deepEqual(body.input, [
		{ type: "additional_tools", role: "developer", tools: [{ type: "function", name: "exec_command" }] },
		{ type: "message", role: "developer", content: [{ type: "input_text", text: "Be useful" }] },
		{ type: "message", role: "user", content: [
			{ type: "input_image", image_url: "data:image/png;base64,AAA" },
			{ type: "input_text", text: "image content omitted because remote image URLs are not supported" },
		] },
	]);
});

test("Responses Lite carries its transport flag in WebSocket metadata", () => {
	const body = applyResponsesLiteWebSocketMetadata({ model: "gpt-5.6-sol", input: [] });
	assert.equal(body.client_metadata?.["ws_request_header_x_openai_internal_codex_responses_lite"], "true");
});
