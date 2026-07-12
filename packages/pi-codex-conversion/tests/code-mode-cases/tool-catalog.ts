import assert from "node:assert/strict";
import test from "node:test";
import { createCodeModeHarness } from "../helpers/code-mode-harness.ts";

test("Code Mode advertises only model-compatible nested tools", async () => {
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
		assert.match(
			promptResult?.systemPrompt ?? "",
			/src\/tools\/code-mode\/CUSTOM-TOOLS\.md/,
		);
		assert.match(
			promptResult?.systemPrompt ?? "",
			/apply_patch: await tools\.apply_patch\(patch\)/,
		);
		assert.match(promptResult?.systemPrompt ?? "", /view_image: const result = await tools\.view_image/);
		assert.match(promptResult?.systemPrompt ?? "", /web__run: await tools\.web__run/);
		assert.match(promptResult?.systemPrompt ?? "", /image_gen__imagegen: await tools\.image_gen__imagegen/);
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
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /view_image:/);
		assert.doesNotMatch(textOnlyPrompt?.systemPrompt ?? "", /image_gen__imagegen:/);
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
		assert.match(fallbackPrompt?.systemPrompt ?? "", /view_image: const description = await tools\.view_image/);
		(runtime as any).state.config.tools.viewImageFallback = false;
	} finally {
		await fixture.close();
	}
});
