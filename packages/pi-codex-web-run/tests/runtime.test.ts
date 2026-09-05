import assert from "node:assert/strict";
import test from "node:test";
import { ChatGptCloudflareCookieStore } from "../src/codex-runtime/cloudflare-cookies.js";
import {
	isCodexToolRoute,
	normalizeCodexToolRouteConfig,
	resolveCodexToolModel,
} from "../src/codex-runtime/config.js";
import { fetchCodexTool } from "../src/codex-runtime/http.js";
import { resolveHostedCodexToolProvider } from "../src/codex-runtime/policy.js";
import { resolveCodexToolProvider } from "../src/codex-runtime/resolve.js";
import { resolveCodexSearchUrl } from "../src/codex-runtime/urls.js";

test("Codex requests keep provider policy and bounded HTTP state", async () => {
	const routes = normalizeCodexToolRouteConfig({
		providers: {
			"Company-Codex": { "gpt-5.6-luna": "company-luna" },
		},
	});
	assert.equal(
		isCodexToolRoute(routes, {
			provider: "company-codex",
			id: "other",
		} as never),
		true,
	);
	assert.equal(
		resolveCodexToolModel(
			routes,
			{ provider: "COMPANY-CODEX" } as never,
			"gpt-5.6-luna",
		),
		"company-luna",
	);
	assert.equal(
		resolveCodexToolModel(
			routes,
			{ provider: "openai-codex" } as never,
			"gpt-5.6-luna",
		),
		"gpt-5.6-luna",
	);
	const routed = await resolveCodexToolProvider(
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
	);
	assert.deepEqual(routed, {
		route: "openai-codex",
		baseUrl: "https://proxy.example/api/codex",
		responsesUrl: "https://proxy.example/api/codex/responses",
		searchUrl: "https://proxy.example/api/codex/alpha/search",
		model: "company-luna",
		token: "token",
		accountId: "account",
	});
	const handlers = new Map<string, Array<(value: unknown) => void>>();
	const pi = {
		events: {
			on(channel: string, handler: (value: unknown) => void) {
				const entries = handlers.get(channel) ?? [];
				entries.push(handler);
				handlers.set(channel, entries);
				return () =>
					handlers.set(
						channel,
						entries.filter((entry) => entry !== handler),
					);
			},
			emit(channel: string, value: unknown) {
				for (const handler of handlers.get(channel) ?? []) handler(value);
			},
		},
	};
	const provider = {
		route: "openai-codex" as const,
		baseUrl: "https://chatgpt.com/backend-api/codex",
		responsesUrl: "https://chatgpt.com/backend-api/codex/responses",
		searchUrl: "https://chatgpt.com/backend-api/codex/alpha/search",
		model: "gpt-5.6-luna",
		token: "token",
		accountId: "account",
	};
	pi.events.on(
		"@howaboua/pi-codex-conversion.provider-resolver/v1",
		(value) => {
			if (
				value &&
				typeof value === "object" &&
				"use" in value &&
				typeof value.use === "function"
			)
				value.use(async (ctx: { model: { provider: string } }) => {
					assert.equal(ctx.model.provider, "openai-codex");
					return provider;
				});
		},
	);
	assert.deepEqual(
		await resolveHostedCodexToolProvider(
			pi as never,
			{
				model: { provider: "meta", api: "openai-responses", id: "muse" },
				modelRegistry: {
					find: () => ({
						provider: "openai-codex",
						api: "openai-codex-responses",
						id: "gpt-5.6-luna",
					}),
				},
			} as never,
		),
		provider,
	);
	assert.equal(
		resolveCodexSearchUrl("https://chatgpt.com/backend-api/codex/responses"),
		"https://chatgpt.com/backend-api/codex/alpha/search",
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
