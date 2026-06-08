import test from "node:test";
import assert from "node:assert/strict";
import { createImageGenerationTool, supportsNativeImageGeneration } from "../src/tools/image-generation-tool.ts";

function renderText(component: { render(width: number): string[] } | undefined): string {
	assert.ok(component);
	return component.render(120).map((line) => line.trimEnd()).join("\n");
}

const theme = { fg: (_role: string, text: string) => text, bold: (text: string) => text };

test("imagegen is a valid flat Pi tool name", () => {
	const tool = createImageGenerationTool();
	assert.equal(tool.name, "imagegen");
	assert.doesNotMatch(tool.name, /[^a-zA-Z0-9_-]/);
});

test("imagegen renders Codex-style label", () => {
	const tool = createImageGenerationTool();
	assert.equal(renderText(tool.renderCall?.({ prompt: "draw" }, theme as never, {} as never)), "• Generated Image:\n  └ draw");
});

test("supportsNativeImageGeneration enables image-capable Responses-compatible models", () => {
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", input: ["text", "image"] } as never), true);
	assert.equal(supportsNativeImageGeneration({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark", input: ["text"] } as never), false);
	assert.equal(supportsNativeImageGeneration({ provider: "custom", api: "custom-chat", id: "claude", input: ["text", "image"] } as never), false);
});
