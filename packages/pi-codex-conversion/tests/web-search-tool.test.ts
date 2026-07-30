import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveCodexSearchUrl } from "../src/adapter/codex-tool-provider.ts";
import { isExplicitlyConfiguredToolProvider } from "../src/extension/tools.ts";
import { buildWebSearchInput } from "../src/tools/web-run/history.ts";
test("proxy tool routing requires explicit provider configuration", () => {
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		scope: { allProviders: "on" as const, additionalProviders: ["responses-proxy"] },
	};
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "responses-proxy", api: "openai-responses" } as never, config), true);
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "unlisted-proxy", api: "openai-responses" } as never, config), false);
});

test("native web search URL follows direct and proxy Responses routes", () => {
	assert.equal(
		resolveCodexSearchUrl("https://chatgpt.com/backend-api/codex"),
		"https://chatgpt.com/backend-api/codex/alpha/search",
	);
	assert.equal(
		resolveCodexSearchUrl("https://proxy.example/api/codex/responses"),
		"https://proxy.example/api/codex/alpha/search",
	);
});

test("native web search receives the previous visible turn and current user text", () => {
	const entry = (id: string, role: "user" | "assistant" | "toolResult", content: unknown) => ({
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-01-01T00:00:00.000Z",
		message: role === "toolResult"
			? { role, toolCallId: id, toolName: "web_run", content, isError: false, timestamp: 0 }
			: { role, content, timestamp: 0 },
	});
	const entries = [
		entry("old-user", "user", "old user"),
		entry("old-assistant", "assistant", [{ type: "text", text: "old assistant" }]),
		entry("previous-user", "user", [{ type: "text", text: "previous user" }, { type: "image", data: "ignored" }]),
		entry("tool-result", "toolResult", [{ type: "text", text: "ignored tool output" }]),
		entry("previous-assistant", "assistant", [
			{ type: "thinking", thinking: "ignored reasoning" },
			{ type: "text", text: "complete assistant context" },
			{ type: "toolCall", name: "web_run", arguments: {} },
		]),
		entry("current-user", "user", [{ type: "text", text: "current user" }, { type: "image", data: "ignored" }]),
		entry("current-assistant", "assistant", [{ type: "text", text: "ignored current commentary" }]),
	] as never;

	assert.deepEqual(buildWebSearchInput(entries), [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "previous user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "complete assistant context" }] },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] },
	]);
});
