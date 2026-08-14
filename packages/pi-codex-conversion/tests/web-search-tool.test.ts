import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { isExplicitlyConfiguredToolProvider } from "../src/extension/tools.ts";

test("proxy tool routing requires explicit provider configuration", () => {
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		scope: { allProviders: "on" as const, additionalProviders: ["responses-proxy"] },
	};
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "responses-proxy", api: "openai-responses" } as never, config), true);
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "unlisted-proxy", api: "openai-responses" } as never, config), false);
});
