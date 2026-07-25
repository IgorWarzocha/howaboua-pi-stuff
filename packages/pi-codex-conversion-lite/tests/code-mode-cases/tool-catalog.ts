import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode routes image tools by model capability", async () => {
	const fixture = await createCodeModeHarness();
	const { handlers, runtime } = fixture;
	try {
		const promptHandler = handlers.get("before_agent_start")?.[0];
		const promptResult = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text", "image"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.match(promptResult?.systemPrompt ?? "", /const result = await tools\.view_image/);
		assert.match(promptResult?.systemPrompt ?? "", /await tools\.image_gen__imagegen/);
		const textOnlyPrompt = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /tools\.view_image/);
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /tools\.image_gen__imagegen/);
		(runtime as any).state.config.tools.viewImageFallback = true;
		const fallbackPrompt = promptHandler?.(
			{ systemPrompt: "Base" },
			{
				model: {
					provider: "openai-codex",
					api: "openai-codex-responses",
					id: "gpt-5.6-luna",
					input: ["text"],
				},
			},
		) as { systemPrompt?: string } | undefined;
		assert.match(fallbackPrompt?.systemPrompt ?? "", /const description = await tools\.view_image/);
		(runtime as any).state.config.tools.viewImageFallback = false;
	} finally {
		await fixture.close();
	}
});
