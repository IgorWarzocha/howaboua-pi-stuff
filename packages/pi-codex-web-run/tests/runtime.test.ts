import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createEventBus } from "@earendil-works/pi-coding-agent";
import { ChatGptCloudflareCookieStore } from "../src/codex-runtime/cloudflare-cookies.js";
import {
	isCodexToolRoute,
	readCodexToolRouteConfig,
	resolveCodexToolModel,
} from "../src/codex-runtime/config.js";
import { fetchCodexTool } from "../src/codex-runtime/http.js";
import { resolveHostedCodexToolProvider } from "../src/codex-runtime/policy.js";
import { resolveCodexToolProvider } from "../src/codex-runtime/resolve.js";

test("Codex requests preserve configured routing and bounded HTTP state", async (t) => {
	const directory = mkdtempSync(join(tmpdir(), "codex-routes-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const configPath = join(directory, "pi-codex-tools.json");
	writeFileSync(
		configPath,
		JSON.stringify({
			providers: {
				"Company-Codex": { "gpt-5.6-luna": "company-luna" },
			},
		}),
	);
	const routes = readCodexToolRouteConfig(configPath);
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

	const pi = { events: createEventBus() };
	const provider = { token: "hosted-provider-token" };
	pi.events.on(
		"@howaboua/pi-codex-conversion.provider-resolver/v1",
		(request) => {
			const { use } = request as {
				use(
					resolver: (ctx: {
						model: { provider: string };
					}) => Promise<typeof provider>,
				): void;
			};
			use(async (ctx) => {
				assert.equal(ctx.model.provider, "openai-codex");
				return provider;
			});
		},
	);
	assert.equal(
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
