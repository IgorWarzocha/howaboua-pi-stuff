import test from "node:test";
import assert from "node:assert/strict";
import { resolveCodexApiProviderBaseUrl } from "../src/adapter/codex-tool-provider.ts";

test("resolveCodexApiProviderBaseUrl mirrors Codex provider base shape", () => {
	assert.equal(resolveCodexApiProviderBaseUrl("https://chatgpt.com/backend-api/codex/responses"), "https://chatgpt.com/backend-api/codex");
	assert.equal(resolveCodexApiProviderBaseUrl("https://chatgpt.com/backend-api/codex"), "https://chatgpt.com/backend-api/codex");
	assert.equal(resolveCodexApiProviderBaseUrl("https://chatgpt.com/backend-api"), "https://chatgpt.com/backend-api/codex");
	assert.equal(resolveCodexApiProviderBaseUrl("http://127.0.0.1:8061"), "http://127.0.0.1:8061/api/codex");
	assert.equal(resolveCodexApiProviderBaseUrl("http://127.0.0.1:8061/api/codex"), "http://127.0.0.1:8061/api/codex");
	assert.equal(resolveCodexApiProviderBaseUrl("http://127.0.0.1:8061/api"), "http://127.0.0.1:8061/api/codex");
});
