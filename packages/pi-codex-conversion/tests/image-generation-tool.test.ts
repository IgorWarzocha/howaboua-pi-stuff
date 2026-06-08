import test from "node:test";
import assert from "node:assert/strict";
import { supportsNativeImageGeneration } from "../src/tools/imagegen/tool.ts";


test("supportsNativeImageGeneration enables image-capable Responses-compatible models", () => {
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", input: ["text", "image"] } as never), true);
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark", input: ["text"] } as never), false);
	assert.equal(supportsNativeImageGeneration({ provider: "custom", api: "custom-chat", id: "claude", input: ["text", "image"] } as never), false);
});
