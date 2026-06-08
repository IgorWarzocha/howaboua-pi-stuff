import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexWebSearchRequest, buildRecentWebSearchInput, createWebSearchTool, executeCodexWebSearchFetch, resolveAlphaSearchUrlFromBase, supportsMultimodalNativeWebSearch, supportsNativeWebSearch } from "../src/tools/web-search-tool.ts";

function fakeJwt(accountId: string): string {
	return ["header", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url"), "signature"].join(".");
}

function createContext(options: { token?: string; accountId?: string; baseUrl?: string; model?: string; headers?: Record<string, string> } = {}) {
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
					apiKey: options.headers ? undefined : token,
					headers: options.headers ?? (options.accountId ? { "chatgpt-account-id": options.accountId } : {}),
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
	assert.equal(resolveAlphaSearchUrlFromBase("https://chatgpt.com/backend-api/codex/responses"), "https://chatgpt.com/backend-api/codex/alpha/search");
});



test("buildRecentWebSearchInput mirrors Codex standalone web search context tail", () => {
	const input = buildRecentWebSearchInput([
		{ role: "user", content: [{ type: "input_text", text: "old user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "old assistant", annotations: [] }], status: "completed" },
		{ role: "user", content: [{ type: "input_text", text: "previous user" }, { type: "input_image", image_url: "data:image/png;base64,x" } as never] },
		{ type: "function_call", name: "tool", arguments: "{}", call_id: "call-1" },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous assistant", annotations: [] }], status: "completed" },
		{ role: "user", content: [{ type: "input_text", text: "<environment_context>ignore</environment_context>" }] },
		{ role: "user", content: [{ type: "input_text", text: "current user" }] },
	] as never);
	assert.deepEqual(input, [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "previous user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous assistant", annotations: [] }], status: "completed" },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] },
	]);
});

test("buildCodexWebSearchRequest matches Codex alpha/search request defaults", () => {
	const body = buildCodexWebSearchRequest({ search_query: [{ q: "OpenAI", recency: 7 }], response_length: "short" }, { baseUrl: "https://chatgpt.com/api/codex", model: "gpt-5.4", token: "token", accountId: "acct" });
	assert.match(body["id"] as string, /^pi-web-run-/);
	assert.equal(body["model"], "gpt-5.4");
	assert.deepEqual(body["commands"], { search_query: [{ q: "OpenAI", recency: 7 }], response_length: "short" });
	assert.deepEqual(body["settings"], { allowed_callers: ["direct"], external_web_access: true });
	assert.equal(body["input"], undefined);
});



test("buildCodexWebSearchRequest includes recent input when no explicit input is passed", () => {
	const provider = { baseUrl: "https://chatgpt.com/backend-api/codex", model: "gpt-5.4-mini", token: fakeJwt("acct"), accountId: "acct" };
	const recentInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] }];
	const request = buildCodexWebSearchRequest({ search_query: [{ q: "OpenAI" }] }, provider, recentInput as never);
	assert.equal(request["input"], recentInput);
});

test("buildCodexWebSearchRequest preserves explicit structured input", () => {
	const provider = { baseUrl: "https://chatgpt.com/backend-api/codex", model: "gpt-5.4-mini", token: fakeJwt("acct"), accountId: "acct" };
	const explicitInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "explicit" }] }];
	const recentInput = [{ role: "user", content: [{ type: "input_text", text: "recent" }] }];
	const request = buildCodexWebSearchRequest({ input: explicitInput, search_query: [{ q: "OpenAI" }] }, provider, recentInput as never);
	assert.equal(request["input"], explicitInput);
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

		const encrypted = await executeCodexWebSearchFetch({ search_query: [{ q: "OpenAI" }] }, createContext({ accountId: "pi-account" }), undefined);
		assert.equal(encrypted, "ciphertext");
		assert.equal(captured?.url, "https://chatgpt.com/backend-api/codex/alpha/search");
		const headers = captured!.init.headers as Headers;
		assert.equal(headers.get("authorization")?.startsWith("Bearer poison-token"), false);
		assert.equal(headers.get("chatgpt-account-id"), "pi-account");
		assert.equal(headers.get("originator"), "codex_cli_rs");
		assert.match(headers.get("user-agent") ?? "", /^codex_cli_rs\/0\.0\.0 /);
		assert.equal(headers.get("version"), "0.0.0");
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



test("executeCodexWebSearch accepts case-insensitive auth headers from Pi model registry", async () => {
	const originalFetch = globalThis.fetch;
	let captured: { init: RequestInit } | undefined;
	try {
		globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			captured = { init: init ?? {} };
			return new Response(JSON.stringify({ encrypted_output: "ciphertext" }), { status: 200 });
		}) as typeof fetch;
		await executeCodexWebSearchFetch(
			{ search_query: [{ q: "OpenAI" }] },
			createContext({ headers: { Authorization: "Bearer header-token", "ChatGPT-Account-ID": "header-account" } }),
			undefined,
		);
		const headers = captured!.init.headers as Headers;
		assert.equal(headers.get("authorization"), "Bearer header-token");
		assert.equal(headers.get("chatgpt-account-id"), "header-account");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("createWebSearchTool does not fall back when standalone alpha/search is unavailable", async () => {
	const originalFetch = globalThis.fetch;
	const originalFetchEnv = process.env["PI_CODEX_WEB_RUN_TS_FETCH"];
	let calls = 0;
	try {
		process.env["PI_CODEX_WEB_RUN_TS_FETCH"] = "1";
		globalThis.fetch = (async () => {
			calls += 1;
			return new Response(JSON.stringify({ detail: "Not Found" }), { status: 404, headers: { "content-type": "application/json" } });
		}) as typeof fetch;
		await assert.rejects(
			() => createWebSearchTool().execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ accountId: "pi-account" })),
			/Codex alpha\/search endpoint unavailable/,
		);
		assert.equal(calls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalFetchEnv === undefined) delete process.env["PI_CODEX_WEB_RUN_TS_FETCH"];
		else process.env["PI_CODEX_WEB_RUN_TS_FETCH"] = originalFetchEnv;
	}
});

test("createWebSearchTool returns encrypted web_run details through Pi's tool system", async () => {
	const originalFetch = globalThis.fetch;
	const originalFetchEnv = process.env["PI_CODEX_WEB_RUN_TS_FETCH"];
	try {
		process.env["PI_CODEX_WEB_RUN_TS_FETCH"] = "1";
		globalThis.fetch = (async () => new Response(JSON.stringify({ encrypted_output: "ciphertext" }), { status: 200 })) as typeof fetch;
		const result = await createWebSearchTool().execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ accountId: "pi-account" }));
		assert.deepEqual(result.content, [{ type: "text", text: "[encrypted web search output]" }]);
		assert.deepEqual(result.details, { webRun: { encrypted_output: "ciphertext" } });
	} finally {
		globalThis.fetch = originalFetch;
		if (originalFetchEnv === undefined) delete process.env["PI_CODEX_WEB_RUN_TS_FETCH"];
		else process.env["PI_CODEX_WEB_RUN_TS_FETCH"] = originalFetchEnv;
	}
});

test("executeCodexWebSearch reports Cloudflare and non-JSON failures", async () => {
	const originalFetch = globalThis.fetch;
	try {
		globalThis.fetch = (async () => new Response("<html>not json</html>", { status: 200 })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearchFetch({}, createContext(), undefined), /expected JSON response/);
		globalThis.fetch = (async () => new Response("<html>Cloudflare blocked</html>", { status: 403 })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearchFetch({}, createContext(), undefined), /HTTP 403 Cloudflare challenge/);
		globalThis.fetch = (async () => new Response("<html>challenge</html>", { status: 200, headers: { "cf-mitigated": "challenge", server: "cloudflare" } })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearchFetch({}, createContext(), undefined), /Cloudflare challenge/);
		globalThis.fetch = (async () => new Response(JSON.stringify({ detail: "Not Found" }), { status: 404 })) as typeof fetch;
		await assert.rejects(() => executeCodexWebSearchFetch({}, createContext(), undefined), /Codex alpha\/search endpoint unavailable/);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
