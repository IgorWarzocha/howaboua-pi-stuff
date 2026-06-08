import test from "node:test";
import assert from "node:assert/strict";
import { rewriteNativeImageGenerationTool, supportsNativeImageGeneration } from "../src/tools/image-generation-tool.ts";

test("supportsNativeImageGeneration only enables image-capable openai-codex models", () => {
	assert.equal(
		supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", input: ["text", "image"] } as never),
		true,
	);
	assert.equal(
		supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark", input: ["text"] } as never),
		false,
	);
	assert.equal(
		supportsNativeImageGeneration({ provider: "openai", api: "openai-responses", id: "gpt-5", input: ["text", "image"] } as never),
		false,
	);
});

test("rewriteNativeImageGenerationTool replaces only supported adapter function tools", () => {
	const payload = {
		model: "gpt-5.4",
		tools: [
			{ type: "function", name: "exec_command", parameters: { type: "object" } },
			{ type: "function", name: "image_generation", parameters: { type: "object" } },
		],
	};

	assert.deepEqual(
		rewriteNativeImageGenerationTool(
			payload,
			{ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", input: ["text", "image"] } as never,
		),
		{
			model: "gpt-5.4",
			tools: [
				{ type: "function", name: "exec_command", parameters: { type: "object" } },
				{ type: "image_generation", output_format: "png" },
			],
		},
	);

	assert.equal(
		rewriteNativeImageGenerationTool(
			payload,
			{ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark", input: ["text"] } as never,
		),
		payload,
	);
	assert.equal(
		rewriteNativeImageGenerationTool(payload, { provider: "openai", api: "openai-responses", id: "gpt-5", input: ["text", "image"] } as never),
		payload,
	);
});
