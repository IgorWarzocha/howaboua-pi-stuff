import test from "node:test";
import assert from "node:assert/strict";
import { createImageGenerationTool, supportsNativeImageGeneration } from "../src/tools/imagegen/tool.ts";


test("supportsNativeImageGeneration enables image-capable Responses-compatible models", () => {
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", input: ["text", "image"] } as never), true);
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark", input: ["text"] } as never), false);
	assert.equal(supportsNativeImageGeneration({ provider: "custom", api: "custom-chat", id: "claude", input: ["text", "image"] } as never), false);
});

test("imagegen executes only for native or explicitly configured Codex providers", async () => {
	const ctx = {
		cwd: process.cwd(),
		model: { provider: "custom-responses", api: "openai-codex-responses", id: "gpt-image", input: ["text", "image"] },
	} as never;
	await assert.rejects(
		() => createImageGenerationTool().execute("call", { prompt: "draw" }, undefined, undefined as never, ctx),
		/requires an image-capable OpenAI Codex-compatible Responses provider/,
	);
});

