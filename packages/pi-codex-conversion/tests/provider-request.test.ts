import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";

function createState(mode: "normal" | "path" = "normal", fast = false): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			mode,
			scope: { allProviders: false, additionalProviders: ["my-provider"] },
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, fast },
			tools: { ...DEFAULT_CODEX_CONVERSION_CONFIG.tools, webRun: true, imageGeneration: true },
		},
	};
}

const ctx = {
	hasUI: false,
	model: { provider: "my-provider", api: "custom-responses", id: "gpt-5", input: ["text", "image"] },
} as never;

test("rewriteCodexProviderRequest applies fast mode to proxied providers when proxy tools are on", async () => {
	const payload = { model: "gpt-5", tools: [] };

	assert.deepEqual(await rewriteCodexProviderRequest(payload, ctx, createState("normal", true)), {
		...payload,
		service_tier: "priority",
		text: { verbosity: "low" },
	});
});
