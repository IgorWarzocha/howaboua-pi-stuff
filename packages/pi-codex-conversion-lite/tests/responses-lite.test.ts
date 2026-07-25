import test from "node:test";
import assert from "node:assert/strict";
import { applyResponsesLiteRequest, prepareResponsesLiteRequestImages } from "../src/providers/openai-codex/responses-lite.ts";

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
			{ type: "custom_tool_call_output", call_id: "call_1", output: [
				{ type: "input_image", image_url: "https://example.com/tool.png", detail: "high" },
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
		{ type: "custom_tool_call_output", call_id: "call_1", output: [
			{ type: "input_text", text: "image content omitted because remote image URLs are not supported" },
		] },
	]);
});

test("Responses Lite validates inline images before transport", async () => {
	const validPng = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
	const body = await prepareResponsesLiteRequestImages(applyResponsesLiteRequest({
		model: "gpt-5.6-luna",
		input: [
			{ type: "message", role: "user", content: [
				{ type: "input_image", image_url: `data:image/png;base64,${validPng}`, detail: "high" },
				{ type: "input_image", image_url: "data:image/png;base64,not-valid" },
			] },
			{ type: "custom_tool_call_output", call_id: "call_1", output: [
				{ type: "input_image", image_url: "data:image/png;base64,not-valid" },
			] },
		],
	}));
	const content = (body.input[1] as { content: Array<{ type: string; image_url?: string; text?: string }> }).content;
	assert.equal(content[0]?.type, "input_image");
	assert.match(content[0]?.image_url ?? "", /^data:image\/(?:png|jpeg);base64,/);
	assert.deepEqual(content[1], { type: "input_text", text: "image content omitted because it could not be processed" });
	assert.deepEqual((body.input[2] as { output: unknown[] }).output, [
		{ type: "input_text", text: "image content omitted because it could not be processed" },
	]);
});
