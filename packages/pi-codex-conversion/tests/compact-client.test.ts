import test from "node:test";
import assert from "node:assert/strict";
import { executeNativeCompaction } from "../src/adapter/compaction/compact-client.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { applyResponsesLiteRequest } from "../src/providers/openai-codex/responses-lite.ts";

test("native Codex compaction replays and preserves turn state", async () => {
	const originalFetch = globalThis.fetch;
	const turnState = createCodexTurnState();
	turnState.capture("ts-1");
	let requestHeaders: Headers | undefined;
	let requestBody: Record<string, unknown> | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			requestHeaders = new Headers(init?.headers);
			requestBody = JSON.parse(String(init?.body));
			return new Response(JSON.stringify({ id: "cmp_1", output: [{ type: "compaction_summary", encrypted_content: "sealed" }] }), {
				status: 200,
				headers: { "content-type": "application/json", "x-codex-turn-state": "ts-2" },
			});
		}) as typeof fetch;

		const result = await executeNativeCompaction({
			runtime: {
				provider: "openai-codex",
				api: "openai-codex-responses",
				apiFamily: "openai-codex-responses",
				model: "gpt-5.6-luna",
				baseUrl: "https://chatgpt.example/backend-api",
				apiKey: "token",
				compactPath: "codex/responses/compact",
				compactUrl: "https://chatgpt.example/backend-api/codex/responses/compact",
				currentModel: { headers: {} },
			} as never,
			request: applyResponsesLiteRequest({
				model: "gpt-5.6-luna",
				input: [],
				instructions: "compact",
				tools: [{ type: "function", name: "exec_command" }],
				parallel_tool_calls: true,
			}),
			responsesLite: true,
			turnState,
			sessionId: "session-1",
		});

		assert.equal(result.ok, true);
		assert.equal(requestHeaders?.get("x-codex-turn-state"), "ts-1");
		assert.equal(requestHeaders?.get("session-id"), "session-1");
		assert.equal(requestHeaders?.get("thread-id"), "session-1");
		assert.equal(requestHeaders?.get("x-openai-internal-codex-responses-lite"), "true");
		assert.equal("instructions" in (requestBody ?? {}), false);
		assert.equal("tools" in (requestBody ?? {}), false);
		assert.equal(requestBody?.["parallel_tool_calls"], false);
		assert.equal((requestBody?.["input"] as Array<{ type?: string }>)[0]?.type, "additional_tools");
		assert.equal((requestBody?.["reasoning"] as { context?: string }).context, "all_turns");
		assert.equal(turnState.current(), "ts-1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
