import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/config.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import type { AdapterState } from "../src/adapter/state.ts";

function createState(adapterProviderCodexTools = true, fast = false): AdapterState {
	return {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			useAdapterProviders: true,
			adapterProviders: ["my-provider"],
			adapterProviderCodexTools,
			fast,
			webSearch: true,
			imageGeneration: true,
		},
	};
}

const ctx = {
	hasUI: false,
	model: { provider: "my-provider", api: "custom-responses", id: "gpt-5", input: ["text", "image"] },
} as never;

test("rewriteCodexProviderRequest rewrites optional native tools for proxied providers", async () => {
	const payload = {
		model: "gpt-5",
		tools: [
			{ type: "function", name: "web.run", parameters: { type: "object" } },
			{ type: "function", name: "image_generation", parameters: { type: "object" } },
		],
	};

	assert.deepEqual(await rewriteCodexProviderRequest(payload, ctx, createState()), {
		model: "gpt-5",
		include: ["web_search_call.action.sources", "web_search_call.results"],
		text: { verbosity: "low" },
		tools: [
			{ type: "web_search", external_web_access: true, search_content_types: ["text", "image"] },
			{ type: "image_generation", output_format: "png" },
		],
	});
});

test("rewriteCodexProviderRequest applies fast mode to proxied providers when proxy tools are on", async () => {
	const payload = { model: "gpt-5", tools: [] };

	assert.deepEqual(await rewriteCodexProviderRequest(payload, ctx, createState(true, true)), {
		...payload,
		service_tier: "priority",
		text: { verbosity: "low" },
	});
});

test("rewriteCodexProviderRequest leaves optional native tools alone when proxy tools are off", async () => {
	const payload = { model: "gpt-5", tools: [{ type: "function", name: "web.run", parameters: { type: "object" } }] };

	assert.deepEqual(await rewriteCodexProviderRequest(payload, ctx, createState(false, true)), {
		...payload,
		text: { verbosity: "low" },
	});
});
