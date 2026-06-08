import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexWebSearchRequest, createWebSearchTool, executeCodexWebSearch, resolveAlphaSearchUrlFromBase, supportsMultimodalNativeWebSearch, supportsNativeWebSearch } from "../src/tools/web-search-tool.ts";

function fakeJwt(accountId: string): string {
	return ["header", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url"), "signature"].join(".");
}

function createContext(options: { token?: string; accountId?: string; baseUrl?: string; model?: string } = {}) {
	const token = options.token ?? fakeJwt(options.accountId ?? "acct-from-token");
	return {
		cwd: process.cwd(),
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: options.model ?? "gpt-live",
			baseUrl: options.baseUrl ?? "https://chatgpt.com/backend-api/codex/responses",
		},
		modelRegistry: {
			async getApiKeyAndHeaders() {
				return {
					ok: true,
					apiKey: token,
					headers: options.accountId ? { "chatgpt-account-id": options.accountId } : {},
				};
			},
		},
	} as never;
}

test("web_run is a valid flat Pi tool name", () => {
	const tool = createWebSearchTool();
	assert.equal(tool.name, "web_run");
	assert.doesNotMatch(tool.name, /[^a-zA-Z0-9_-]/);
});

test("web_run supports OpenAI Codex Responses models and keeps spark text-only", () => {
	assert.equal(supportsNativeWebSearch({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4" } as never), true);
	assert.equal(supportsNativeWebSearch({ provider: "custom", api: "custom-chat", id: "claude" } as never), false);
	assert.equal(supportsMultimodalNativeWebSearch({ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.3-codex-spark" } as never), false);
});


test("resolveAlphaSearchUrlFromBase treats bare server URI as app-server root", () => {
	assert.equal(resolveAlphaSearchUrlFromBase("http://127.0.0.1:8061"), "http://127.0.0.1:8061/api/codex/alpha/search");
	assert.equal(resolveAlphaSearchUrlFromBase("http://127.0.0.1:8061/api/codex"), "http://127.0.0.1:8061/api/codex/alpha/search");
	assert.equal(resolveAlphaSearchUrlFromBase("https://chatgpt.com/backend-api/codex/responses"), "https://chatgpt.com/api/codex/alpha/search");
});

test("buildCodexWebSearchRequest matches Codex alpha/search request defaults", () => {
	const body = buildCodexWebSearchRequest({ search_query: [{ q: "OpenAI", recency: 7 }], response_length: "short" }, { baseUrl: "https://chatgpt.com/api/codex", model: "gpt-5.4", token: "token", accountId: "acct" });
	assert.match(body["id"] as string, /^pi-web-run-/);
	assert.equal(body["model"], "gpt-5.4");
	assert.deepEqual(body["commands"], { search_query: [{ q: "OpenAI", recency: 7 }], response_length: "short" });
	assert.deepEqual(body["settings"], { allowed_callers: ["direct"], external_web_access: true });
	assert.equal(body["input"], undefined);
});

test("executeCodexWebSearch uses Pi-owned model auth and Codex-compatible headers", async () => {
	const originalFetch = globalThis.fetch;
	const originalEnv = { CODEX_HOME: process.env["CODEX_HOME"], PI_CODEX_ACCESS_TOKEN: process.env["PI_CODEX_ACCESS_TOKEN"], PI_CODEX_ACCOUNT_ID: process.env["PI_CODEX_ACCOUNT_ID"] };
	process.env["CODEX_HOME"] = "/must/not/be/read";
	process.env["PI_CODEX_ACCESS_TOKEN"] = "poison-token";
	process.env["PI_CODEX_ACCOUNT_ID"] = "poison-account";
	let captured: { url: string; init: RequestInit } | undefined;
	try {
		globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
			captured = { url: String(url), init: init ?? {} };
			return new Response(JSON.stringify({ encrypted_output: "ciphertext" }), { status: 200, headers: { "content-type": "application/json" } });
		}) as typeof fetch;

		const encrypted = await executeCodexWebSearch({ search_query: [{ q: "OpenAI" }] }, createContext({ accountId: "pi-account" }), undefined);
		assert.equal(encrypted, "ciphertext");
		assert.equal(captured?.url, "https://chatgpt.com/api/codex/alpha/search");
		const headers = captured!.init.headers as Headers;
		assert.equal(headers.get("authorization")?.startsWith("Bearer poison-token"), false);
		assert.equal(headers.get("chatgpt-account-id"), "pi-account");
		assert.equal(headers.get("originator"), "codex_cli_rs");
		assert.match(headers.get("user-agent") ?? "", /^codex_cli_rs\/0\.0\.0 /);
		assert.equal(headers.get("accept"), "application/json");
		assert.equal(headers.get("content-type"), "application/json");
		assert.deepEqual(JSON.parse(String(captured!.init.body)).commands, { search_query: [{ q: "OpenAI" }] });
	} finally {
		globalThis.fetch = originalFetch;
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("createWebSearchTool returns encrypted web_run details through Pi's tool system", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => new Response(JSON.stringify({ encrypted_output: "ciphertext" }), { status: 200 })) as typeof fetch;
		const result = await createWebSearchTool().execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ accountId: "pi-account" }));
		assert.deepEqual(result.content, [{ type: "text", text: "[encrypted web search output]" }]);
		assert.deepEqual(result.details, { webRun: { encrypted_output: "ciphertext" } });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("executeCodexWebSearch reports Cloudflare and non-JSON failures", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearch({}, createContext(), undefined), /expected JSON response/);
		globalThis.fetch = (async () => new Response("<html>Cloudflare blocked</html>", { status: 403 })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearch({}, createContext(), undefined), /HTTP 403 Cloudflare challenge/);
		globalThis.fetch = (async () => new Response("<html>challenge</html>", { status: 200, headers: { "cf-mitigated": "challenge", server: "cloudflare" } })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearch({}, createContext(), undefined), /Cloudflare challenge/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
