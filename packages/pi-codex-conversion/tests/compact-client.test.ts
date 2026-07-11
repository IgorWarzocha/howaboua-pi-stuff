import test from "node:test";
import assert from "node:assert/strict";
import { executeNativeCompaction } from "../src/adapter/compaction/compact-client.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

test("native Codex compaction replays and preserves turn state", async () => {
	const originalFetch = globalThis.fetch;
	const turnState = createCodexTurnState();
	turnState.capture("ts-1");
	let requestHeaders: Headers | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			requestHeaders = new Headers(init?.headers);
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
			request: { model: "gpt-5.6-luna", input: [], instructions: "compact" },
			turnState,
		});

		assert.equal(result.ok, true);
		assert.equal(requestHeaders?.get("x-codex-turn-state"), "ts-1");
		assert.equal(turnState.current(), "ts-1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
