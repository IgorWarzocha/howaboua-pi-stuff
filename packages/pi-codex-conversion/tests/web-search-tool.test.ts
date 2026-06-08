import test from "node:test";
import assert from "node:assert/strict";
import { buildAlphaSearchRequest, createWebSearchTool, supportsMultimodalNativeWebSearch, supportsNativeWebSearch } from "../src/tools/web-search-tool.ts";

test("web_run is a valid flat Pi tool name", () => {
	const tool = createWebSearchTool();
	assert.equal(tool.name, "web_run");
	assert.doesNotMatch(tool.name, /[^a-zA-Z0-9_-]/);
});

test("web_run supports OpenAI Codex Responses models and keeps spark text-only", () => {
	assert.equal(supportsNativeWebSearch({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" } as never), true);
	assert.equal(supportsNativeWebSearch({ provider: "custom", api: "custom-chat", id: "claude" } as never), false);
	assert.equal(supportsMultimodalNativeWebSearch({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark" } as never), false);
});

test("buildAlphaSearchRequest matches Codex alpha/search shape", () => {
	const request = buildAlphaSearchRequest(
		{
			search_query: [{ q: "OpenAI news", recency: 7, domains: ["openai.com"] }],
			open: [{ ref_id: "https://openai.com", lineno: 12 }],
			settings: { search_context_size: "low" },
			max_output_tokens: 2500,
		},
		{ model: { id: "gpt-test" } } as never,
	);

	assert.match(request["id"] as string, /^pi-web-run-/);
	assert.deepEqual({ ...request, id: "session" }, {
		id: "session",
		model: "gpt-test",
		commands: {
			search_query: [{ q: "OpenAI news", recency: 7, domains: ["openai.com"] }],
			open: [{ ref_id: "https://openai.com", lineno: 12 }],
		},
		settings: {
			allowed_callers: ["direct"],
			external_web_access: true,
			search_context_size: "low",
		},
		max_output_tokens: 2500,
	});
});
