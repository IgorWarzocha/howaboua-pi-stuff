import test from "node:test";
import assert from "node:assert/strict";
import { rewriteNativeWebSearchTool } from "../src/tools/web-search-tool.ts";

test("rewriteNativeWebSearchTool replaces the adapter function tool with the native openai-codex tool", () => {
	const payload = {
		model: "gpt-5.4",
		tools: [
			{ type: "function", name: "exec_command", parameters: { type: "object" } },
			{ type: "function", name: "web.run", parameters: { type: "object" } },
		],
	};

	assert.deepEqual(
		rewriteNativeWebSearchTool(payload, { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" } as never),
		{
			model: "gpt-5.4",
			include: ["web_search_call.action.sources", "web_search_call.results"],
			tools: [
				{ type: "function", name: "exec_command", parameters: { type: "object" } },
				{ type: "web_search", external_web_access: true, search_content_types: ["text", "image"] },
			],
		},
	);
});

test("rewriteNativeWebSearchTool keeps spark text-only and leaves other providers untouched", () => {
	const sparkPayload = {
		model: "gpt-5.3-codex-spark",
		tools: [{ type: "function", name: "web.run", parameters: { type: "object" } }],
	};
	assert.deepEqual(
		rewriteNativeWebSearchTool(
			sparkPayload,
			{ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark" } as never,
		),
		{
			model: "gpt-5.3-codex-spark",
			include: ["web_search_call.action.sources", "web_search_call.results"],
			tools: [{ type: "web_search", external_web_access: true }],
		},
	);

	const openAiPayload = {
		model: "gpt-5",
		tools: [{ type: "function", name: "web.run", parameters: { type: "object" } }],
	};
	assert.equal(
		rewriteNativeWebSearchTool(openAiPayload, { provider: "openai", api: "openai-responses", id: "gpt-5" } as never),
		openAiPayload,
	);
});
