import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptCloudflareCookieStore } from "../src/codex-runtime/cloudflare-cookies.js";
import {
	isCodexToolRoute,
	normalizeCodexToolRouteConfig,
	resolveCodexToolModel,
} from "../src/codex-runtime/config.js";
import { fetchCodexTool } from "../src/codex-runtime/http.js";
import { resolveCodexToolProvider } from "../src/codex-runtime/resolve.js";

test("Codex requests preserve configured routing and bounded HTTP state", async () => {
	const routes = normalizeCodexToolRouteConfig({
		providers: {
			"Company-Codex": { "gpt-5.6-luna": "company-luna" },
		},
	});
	assert.equal(
		resolveCodexToolModel(
			routes,
			{ provider: "COMPANY-CODEX" } as never,
			"gpt-5.6-luna",
		),
		"company-luna",
	);
	assert.deepEqual(
		await resolveCodexToolProvider(
			{
				model: {
					provider: "company-codex",
					id: "company-luna",
					api: "renamed-responses",
					baseUrl: "https://proxy.example/api/codex",
				},
				modelRegistry: {
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: "token",
						headers: { "chatgpt-account-id": "account" },
					}),
				},
			} as never,
			undefined,
			(model) => isCodexToolRoute(routes, model),
		),
		{
			route: "openai-codex",
			baseUrl: "https://proxy.example/api/codex",
			responsesUrl: "https://proxy.example/api/codex/responses",
			searchUrl: "https://proxy.example/api/codex/alpha/search",
			model: "company-luna",
			token: "token",
			accountId: "account",
		},
	);

	const cookies = new ChatGptCloudflareCookieStore();
	cookies.storeResponse(new URL("https://chatgpt.com/backend-api/codex"), [
		"cf_clearance=allowed; Domain=.chatgpt.com; Path=/; Secure",
		"session=ignored; Domain=.chatgpt.com; Path=/; Secure",
	]);
	assert.equal(
		cookies.requestHeader(new URL("https://chatgpt.com/backend-api/codex")),
		"cf_clearance=allowed",
	);
	assert.equal(
		cookies.requestHeader(new URL("https://example.com/")),
		undefined,
	);
	await assert.rejects(
		fetchCodexTool("data:text/plain,abcdef", { maxResponseBytes: 4 }),
		/exceeded 4 bytes/,
	);
});
