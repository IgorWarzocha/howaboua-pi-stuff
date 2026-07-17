import test from "node:test";
import assert from "node:assert/strict";
import type { Model } from "@earendil-works/pi-ai";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";
import { buildRemoteCompactionV2Window, normalizeRemoteCompactionV2PromptInput } from "../src/adapter/compaction/remote-v2-history.ts";

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
	const streamSimple = (_model: unknown, _context: unknown, options: any) => (async function* () {
		headers = options.headers;
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
		yield { type: "done", reason: "stop", message: { responseId: "resp", stopReason: "stop" } };
	})();
	const result = await executeRemoteCompactionV2({
		runtime: {
			provider: model.provider,
			api: model.api,
			apiFamily: model.api,
			model: model.id,
			baseUrl: model.baseUrl!,
			apiKey: "token",
			headers: { "x-codex-beta-features": "other" },
			compactPath: "codex/responses/compact",
			compactUrl: `${model.baseUrl}/codex/responses/compact`,
			currentModel: model,
		},
		modelRegistry: {
			getRegisteredProviderConfig: () => ({ api: model.api, streamSimple }),
		} as never,
		context: { systemPrompt: "system", messages: [] },
		promptInput: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }],
		requestOptions: { reasoning: { effort: "high", summary: "auto" } },
		sessionId: "session",
		transport: "sse",
		retryDelayMs: 0,
	});

	assert.equal(result.ok, true);
	assert.equal(headers?.["x-codex-beta-features"], "other,remote_compaction_v2");
	assert.equal((request?.["input"] as Array<{ type?: string }>).at(-1)?.type, "compaction_trigger");
	assert.deepEqual(result.ok && result.compaction, { type: "compaction", id: "cmp", encrypted_content: "sealed" });
});

test("Responses compaction v2 retains recent real user turns and removes orphan outputs", () => {
	const contextual = { role: "user", content: [{ type: "input_text", text: "<environment_context>private scaffolding</environment_context>" }] };
	const real = { role: "user", content: [
		{ type: "input_text", text: "remember this exactly" },
		{ type: "input_text", text: "<hook_prompt hook_run_id=\"injected\">hidden hook</hook_prompt>" },
	] };
	const normalized = normalizeRemoteCompactionV2PromptInput([
		{ type: "function_call_output", call_id: "orphan", output: "drop" },
		contextual,
		real,
	]);
	const window = buildRemoteCompactionV2Window(normalized, { type: "compaction", encrypted_content: "sealed" });

	assert.doesNotMatch(JSON.stringify(window), /private scaffolding|hidden hook|orphan/);
	assert.match(JSON.stringify(window), /remember this exactly/);
	assert.equal(window.at(-1)?.["encrypted_content"], "sealed");
});

test("Responses compaction v2 keeps newest user messages whole at the retention boundary", () => {
	const older = { role: "user", content: [{ type: "input_text", text: "o".repeat(24) }] };
	const newest = { role: "user", content: [{ type: "input_text", text: "n".repeat(48) }] };
	const window = buildRemoteCompactionV2Window([older, newest], { type: "compaction", encrypted_content: "sealed" }, 10);

	assert.equal(window.length, 2);
	assert.equal((window[0]?.["content"] as Array<{ text: string }>)[0]?.text, "n".repeat(48));
});
