import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildRecentWebSearchInput, createWebSearchTool, executeCodexWebSearch } from "../src/tools/web-run/tool.ts";


function fakeJwt(accountId: string): string {
	return ["header", Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: accountId } })).toString("base64url"), "signature"].join(".");
}

function createContext(options: { token?: string; accountId?: string; baseUrl?: string; model?: string; provider?: string; api?: string; headers?: Record<string, string>; sessionFile?: string; sessionId?: string } = {}) {
	const token = options.token ?? fakeJwt(options.accountId ?? "acct-from-token");
	return {
		cwd: process.cwd(),
		...(options.sessionFile || options.sessionId ? { sessionManager: {
			getSessionFile: () => options.sessionFile,
			getSessionId: () => options.sessionId,
		} } : {}),
		model: {
			provider: options.provider ?? "openai-codex",
			api: options.api ?? "openai-codex-responses",
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

test("web_run schema tells agents to pass explicit search params", () => {
	const parameters = createWebSearchTool().parameters as { properties?: Record<string, unknown> };
	assert.ok(parameters.properties?.["search_query"]);
	assert.ok(parameters.properties?.["image_query"]);
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
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "draft assistant must not bias search", annotations: [] }], status: "in_progress" },
	] as never);
	assert.deepEqual(input, [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "previous user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "previous assistant", annotations: [] }], status: "completed" },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] },
	]);
});

test("buildRecentWebSearchInput drops first-turn assistant draft", () => {
	const input = buildRecentWebSearchInput([
		{ role: "user", content: [{ type: "input_text", text: "current user" }] },
		{ type: "message", role: "assistant", content: [{ type: "output_text", text: "draft assistant must not bias search", annotations: [] }], status: "in_progress" },
	] as never);
	assert.deepEqual(input, [
		{ type: "message", role: "user", content: [{ type: "input_text", text: "current user" }] },
	]);
});
async function withMockWebRun(script: string, run: (path: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(join(tmpdir(), "pi-web-run-test-"));
	const path = join(dir, "web_run_mock.mjs");
	await writeFile(path, script, { mode: 0o755 });
	try {
		await run(path);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

test("executeCodexWebSearch uses Pi-owned model auth and Codex-compatible env", async () => {
	const originalEnv = { CODEX_HOME: process.env["CODEX_HOME"], PI_CODEX_ACCESS_TOKEN: process.env["PI_CODEX_ACCESS_TOKEN"], PI_CODEX_ACCOUNT_ID: process.env["PI_CODEX_ACCOUNT_ID"], PI_CODEX_WEB_RUN_BIN: process.env["PI_CODEX_WEB_RUN_BIN"] };
	process.env["CODEX_HOME"] = "/must/not/be/read";
	process.env["PI_CODEX_ACCESS_TOKEN"] = "poison-token";
	process.env["PI_CODEX_ACCOUNT_ID"] = "poison-account";
	try {
		await withMockWebRun(`#!/usr/bin/env node
import { writeFileSync } from "node:fs";
let input = "";
process.stdin.on("data", (chunk) => input += chunk);
process.stdin.on("end", () => {
  writeFileSync(process.env.CAPTURE_PATH, JSON.stringify({ env: process.env, input: JSON.parse(input) }));
  console.log(JSON.stringify({ encrypted_output: "ciphertext" }));
});
`, async (webRunPath) => {
			const capturePath = join(tmpdir(), `pi-web-run-capture-${Date.now()}.json`);
			process.env["PI_CODEX_WEB_RUN_BIN"] = webRunPath;
			process.env["CAPTURE_PATH"] = capturePath;
			const recentInput = [{ type: "message", role: "user", content: [{ type: "input_text", text: "context" }] }];
			const output = await executeCodexWebSearch({ id: "model-session", model: "wrong-model", input: [{ bad: true }], search_query: [{ q: "OpenAI" }] }, createContext({ accountId: "pi-account" }), undefined, { sessionId: "session-123", model: "gpt-5.5", getRecentInput: () => recentInput as never });
			assert.equal(output.text, "ciphertext");
			assert.equal(output.details.encrypted_output, "ciphertext");
			const captured = JSON.parse(await readFile(capturePath, "utf8")) as { env: Record<string, string>; input: Record<string, unknown> };
			assert.equal(captured.env["PI_CODEX_ACCESS_TOKEN"]?.startsWith("poison-token"), false);
			assert.equal(captured.env["PI_CODEX_ACCOUNT_ID"], "pi-account");
			assert.equal(captured.env["PI_CODEX_RESPONSES_URL"], "https://chatgpt.com/backend-api/codex/responses");
			assert.equal(captured.input["id"], "session-123");
			assert.equal(captured.input["model"], "gpt-5.5");
			assert.deepEqual(captured.input["input"], recentInput);
			assert.deepEqual(captured.input["search_query"], [{ q: "OpenAI" }]);
		});
	} finally {
		for (const [key, value] of Object.entries(originalEnv)) {
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
});

test("web_run executes for explicitly configured renamed Codex providers only", async () => {
	const originalBin = process.env["PI_CODEX_WEB_RUN_BIN"];
	try {
		await withMockWebRun(`#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => console.log(JSON.stringify({ encrypted_output: "ok" })));
`, async (webRunPath) => {
			process.env["PI_CODEX_WEB_RUN_BIN"] = webRunPath;
			await assert.rejects(
				() => createWebSearchTool().execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ provider: "custom-codex", api: "openai-codex-responses" })),
				/requires an OpenAI Codex-compatible Responses provider/,
			);
			const tool = createWebSearchTool("web_run", { allowConfiguredProvider: (model) => model?.provider === "custom-codex" });
			const result = await tool.execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ provider: "custom-codex", api: "openai-codex-responses" }));
			assert.equal(result.content[0]?.type === "text" ? result.content[0].text : "", "ok");
			assert.deepEqual(result.details, { webRun: { encrypted_output: "ok" } });
		});
	} finally {
		if (originalBin === undefined) delete process.env["PI_CODEX_WEB_RUN_BIN"];
		else process.env["PI_CODEX_WEB_RUN_BIN"] = originalBin;
	}
});

test("createWebSearchTool returns web_run JSON with search results when available", async () => {
	const originalBin = process.env["PI_CODEX_WEB_RUN_BIN"];
	try {
		await withMockWebRun(`#!/usr/bin/env node
process.stdin.resume();
process.stdin.on("end", () => console.log(JSON.stringify({ output_text: "summary", search_results: [{ ref_id: "turn0search0", title: "Example", url: "https://example.com", source: "example.com" }] })));
`, async (webRunPath) => {
			process.env["PI_CODEX_WEB_RUN_BIN"] = webRunPath;
			const result = await createWebSearchTool().execute("call", { search_query: [{ q: "OpenAI" }] }, undefined, undefined as never, createContext({ accountId: "pi-account" }));
			const text = result.content[0]?.type === "text" ? result.content[0].text : "";
			const parsed = JSON.parse(text) as Record<string, unknown>;
			assert.equal(parsed["output_text"], "summary");
			assert.deepEqual(parsed["search_results"], [{ ref_id: "turn0search0", title: "Example", url: "https://example.com", source: "example.com" }]);
		});
	} finally {
		if (originalBin === undefined) delete process.env["PI_CODEX_WEB_RUN_BIN"];
		else process.env["PI_CODEX_WEB_RUN_BIN"] = originalBin;
	}
});
