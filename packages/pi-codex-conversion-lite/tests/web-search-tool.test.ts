import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { isExplicitlyConfiguredToolProvider } from "../src/extension/tools.ts";
import { buildRecentWebSearchInput } from "../src/tools/web-run/tool.ts";

test("web search input keeps the relevant conversation tail", () => {
	const input = buildRecentWebSearchInput([
		{ role: "user", content: [{ type: "input_text", text: "old user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "old assistant", annotations: [] }], status: "completed" },
		{ role: "user", content: [{ type: "input_text", text: "previous user" }, { type: "input_image", image_url: "data:image/png;base64,x" } as never] },
		{ type: "function_call", name: "tool", arguments: "{}", call_id: "call-1" },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous assistant", annotations: [] }], status: "completed" },
		{ role: "user", content: [{ type: "input_text", text: "<environment_context>ignore</environment_context>" }] },
		{ role: "user", content: [{ type: "input_text", text: "current user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "draft assistant must not bias search", annotations: [] }], status: "in_progress" },
	] as never);
	assert.deepEqual(input, [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "previous user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous assistant", annotations: [] }], status: "completed" },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] },
	]);
});
test("proxy tool routing requires explicit provider configuration", () => {
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		scope: { allProviders: "on" as const, additionalProviders: ["responses-proxy"] },
	};
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "responses-proxy", api: "openai-responses" } as never, config), true);
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "unlisted-proxy", api: "openai-responses" } as never, config), false);
});
