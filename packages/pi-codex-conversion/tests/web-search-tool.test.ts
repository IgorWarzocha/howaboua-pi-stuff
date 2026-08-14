import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveCodexToolProvider } from "../src/adapter/codex-tool-provider.ts";
import { isExplicitlyConfiguredToolProvider } from "../src/extension/tools.ts";

const CANONICAL_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

function subscriptionToken(accountId: string): string {
	const payload = Buffer.from(JSON.stringify({
		"https://api.openai.com/auth": { chatgpt_account_id: accountId },
	})).toString("base64url");
	return `header.${payload}.signature`;
}

test("proxy tool routing requires explicit provider configuration", () => {
	const config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		scope: { allProviders: "on" as const, additionalProviders: ["responses-proxy"] },
	};
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "responses-proxy", api: "openai-responses" } as never, config), true);
	assert.equal(isExplicitlyConfiguredToolProvider({ provider: "unlisted-proxy", api: "openai-responses" } as never, config), false);
});

test("canonical alias tool routing keeps Codex transport semantics and active credentials", async () => {
	const requestedProviders: string[] = [];
	const token = subscriptionToken("account-tool-alias");
	const model = {
		provider: "openai-codex-personal",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: CANONICAL_CODEX_BASE_URL,
	};
	const provider = await resolveCodexToolProvider({
		model,
		modelRegistry: {
			getApiKeyAndHeaders: async (requestedModel: typeof model) => {
				requestedProviders.push(requestedModel.provider);
				return { ok: true, apiKey: token, baseUrl: `${CANONICAL_CODEX_BASE_URL}/codex` };
			},
		},
	} as never);

	assert.deepEqual(requestedProviders, ["openai-codex-personal"]);
	assert.equal(provider.route, "openai-codex");
	assert.equal(provider.responsesUrl, `${CANONICAL_CODEX_BASE_URL}/codex/responses`);
	assert.equal(provider.searchUrl, `${CANONICAL_CODEX_BASE_URL}/codex/alpha/search`);
	assert.equal(provider.token, token);
	assert.equal(provider.accountId, "account-tool-alias");
	await assert.rejects(resolveCodexToolProvider({
		model,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: token, baseUrl: "https://example.com/backend-api" }),
		},
	} as never), /canonical.*auth/i);
});

test("stock Codex custom endpoints retain Codex tool routing", async () => {
	const requestedProviders: string[] = [];
	const token = subscriptionToken("account-stock-proxy");
	const model = {
		provider: "openai-codex",
		api: "openai-codex-responses",
		id: "gpt-5.6-sol",
		baseUrl: "https://codex-proxy.example.com/backend-api",
	};
	const provider = await resolveCodexToolProvider({
		model,
		modelRegistry: {
			getApiKeyAndHeaders: async (requestedModel: typeof model) => {
				requestedProviders.push(requestedModel.provider);
				return { ok: true, apiKey: token, baseUrl: model.baseUrl };
			},
		},
	} as never);

	assert.deepEqual(requestedProviders, ["openai-codex"]);
	assert.equal(provider.route, "openai-codex");
	assert.equal(provider.baseUrl, "https://codex-proxy.example.com/backend-api/codex");
	assert.equal(provider.responsesUrl, "https://codex-proxy.example.com/backend-api/codex/responses");
	assert.equal(provider.searchUrl, "https://codex-proxy.example.com/backend-api/codex/alpha/search");
	assert.equal(provider.token, token);
	assert.equal(provider.accountId, "account-stock-proxy");
});

test("noncanonical Responses providers retain explicit configured routing", async () => {
	const model = {
		provider: "some-proxy",
		api: "openai-responses",
		id: "gpt-5.6-sol",
		baseUrl: "https://example.com/v1",
	};
	const ctx = {
		model,
		modelRegistry: {
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "proxy-key", baseUrl: model.baseUrl }),
		},
	} as never;

	await assert.rejects(resolveCodexToolProvider(ctx), /OpenAI Codex-compatible provider/);
	const provider = await resolveCodexToolProvider(ctx, () => true);
	assert.equal(provider.route, "configured-responses");
	assert.equal(provider.responsesUrl, "https://example.com/v1/responses");
});
