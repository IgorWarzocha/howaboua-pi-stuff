import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveCodexSearchUrl } from "../src/adapter/codex-tool-provider.ts";
import { isExplicitlyConfiguredToolProvider } from "../src/extension/tools.ts";
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
