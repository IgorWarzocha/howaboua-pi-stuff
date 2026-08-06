import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "@earendil-works/pi-ai";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";
import { buildRemoteCompactionV2Window, normalizeRemoteCompactionV2PromptInput } from "../src/adapter/compaction/remote-v2-history.ts";
import { closeOpenAICodexWebSocketSessions, recordWebSocketSseFallback } from "../src/providers/openai-codex/websocket.ts";

const model = {
	id: "gpt-5.6-luna",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://chatgpt.example/backend-api",
	contextWindow: 372_000,
	maxTokens: 128_000,
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

test("Responses compaction v2 uses the registered stream and installs one canonical checkpoint", async () => {
	let request: Record<string, unknown> | undefined;
	let headers: Record<string, string | null> | undefined;
	let transport: string | undefined;
	let maxRetries: number | undefined;
	const streamSimple = (_model: unknown, _context: unknown, options: any) => (async function* () {
		headers = options.headers;
		transport = options.transport;
		maxRetries = options.maxRetries;
		request = await options.onPayload({
			model: model.id,
			store: false,
			stream: true,
			input: [],
			text: { verbosity: "low" },
			include: [],
			tool_choice: "auto",
			parallel_tool_calls: true,
		});
		options.onOutputItemDone({ type: "compaction_summary", id: "cmp", encrypted_content: "sealed" });
		yield {
			type: "done",
			reason: "stop",
			message: {
				responseId: "resp",
				stopReason: "stop",
				usage: { input: 100, cacheRead: 900, cacheWrite: 20, output: 30 },
			},
		};
	})();
	recordWebSocketSseFallback("session");
	const result = await executeRemoteCompactionV2({
		runtime: {
			provider: model.provider,
			api: model.api,
			apiFamily: model.api,
			model: model.id,
			baseUrl: model.baseUrl!,
			apiKey: "token",
			headers: { authorization: null, "x-codex-beta-features": "other" },
			currentModel: model,
		},
		modelRegistry: {
			getRegisteredProviderConfig: () => ({ api: model.api, streamSimple }),
		} as never,
		context: { systemPrompt: "system", messages: [] },
		promptInput: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
		requestOptions: { reasoning: { effort: "high", summary: "auto" } },
		tokensBefore: 1_000,
		sessionId: "session",
		retryDelayMs: 0,
	});
	closeOpenAICodexWebSocketSessions("session");

	assert.equal(result.ok, true);
	assert.equal(headers?.["authorization"], null);
	assert.equal(headers?.["x-codex-beta-features"], "other,remote_compaction_v2");
	assert.equal(transport, "sse");
	assert.equal(maxRetries, 2);
	assert.equal((request?.["input"] as Array<{ type?: string }>).at(-1)?.type, "compaction_trigger");
	assert.deepEqual(result.ok && result.compaction, { type: "compaction", id: "cmp", encrypted_content: "sealed" });
	assert.deepEqual(result.ok && result.usage, { inputTokens: 1_020, cachedInputTokens: 900, cacheWriteInputTokens: 20, outputTokens: 30 });
});

test("Responses compaction v2 retains real turns and reconciles tool history", () => {
	const contextual = { role: "user", content: [{ type: "input_text", text: "<environment_context>private scaffolding</environment_context>" }] };
	const real = { role: "user", content: [
		{ type: "input_text", text: "remember this exactly" },
		{ type: "input_text", text: "<hook_prompt hook_run_id=\"injected\">hidden hook</hook_prompt>" },
	] };
	const normalized = normalizeRemoteCompactionV2PromptInput([
		{ type: "function_call_output", call_id: "orphan", output: "drop" },
		{ type: "function_call", id: "fc_pending", call_id: "pending", name: "exec", arguments: "{}" },
		contextual,
		real,
	]);
	const window = buildRemoteCompactionV2Window(normalized, { type: "compaction", encrypted_content: "sealed" });

	assert.deepEqual(normalized[0], { type: "function_call", id: "fc_pending", call_id: "pending", name: "exec", arguments: "{}" });
	assert.deepEqual({ ...normalized[1], id: undefined }, { type: "function_call_output", id: undefined, call_id: "pending", output: "aborted" });
	assert.match(String(normalized[1]?.["id"]), /^fco_/);
	assert.deepEqual(normalizeRemoteCompactionV2PromptInput(normalized), normalized);
	assert.doesNotMatch(JSON.stringify(window), /private scaffolding|hidden hook|orphan/);
	assert.match(JSON.stringify(window), /remember this exactly/);
	assert.equal(window.at(-1)?.["encrypted_content"], "sealed");
});
