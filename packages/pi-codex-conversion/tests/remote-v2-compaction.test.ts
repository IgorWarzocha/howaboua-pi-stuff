import test from "node:test";
import assert from "node:assert/strict";
import { buildRemoteCompactionV2Window, normalizeRemoteCompactionV2PromptInput } from "../src/adapter/compaction/remote-v2-history.ts";
import { executeRemoteCompactionV2 } from "../src/adapter/compaction/remote-v2-client.ts";

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

type CodexTransportCompactionModel = {
	id: string;
	name: string;
	provider: string;
	api: "openai-codex-responses";
	baseUrl: string;
	reasoning: boolean;
	input: Array<"text" | "image">;
	contextWindow: number;
	maxTokens: number;
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

async function runCodexTransportCompaction(
	model: CodexTransportCompactionModel,
	apiKey: string,
) {
	const requestedProviders: string[] = [];
	const streamSimple = async function* (streamModel: unknown, _context: unknown, rawOptions: unknown) {
		const options = rawOptions as {
			apiKey?: string;
			canonicalCompaction?: boolean;
			maxRetries?: number;
			onOutputItemDone?: (item: unknown) => void;
			onPayload?: (payload: unknown) => Promise<unknown>;
		};
		assert.equal((streamModel as { provider?: string }).provider, model.provider);
		assert.equal(options.apiKey, apiKey);
		assert.equal(options.canonicalCompaction, true);
		assert.equal(options.maxRetries, 2);
		const payload = await options.onPayload?.({ model: model.id, input: [] }) as { input?: unknown[] };
		assert.deepEqual(payload.input?.at(-1), { type: "compaction_trigger" });
		options.onOutputItemDone?.({ type: "compaction", encrypted_content: "sealed" });
		yield {
			type: "done",
			reason: "stop",
			message: {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: Date.now(),
				responseId: `resp_${model.provider}_compaction`,
			},
		};
	};
	const result = await executeRemoteCompactionV2({
		runtime: {
			provider: model.provider,
			api: model.api,
			apiFamily: model.api,
			codexTransport: true,
			model: model.id,
			baseUrl: model.baseUrl,
			apiKey,
			currentModel: model,
		},
		modelRegistry: {
			getRegisteredProviderConfig: (provider: string) => {
				requestedProviders.push(provider);
				return { api: "openai-codex-responses", streamSimple };
			},
		} as never,
		context: { messages: [] },
		promptInput: [{ role: "user", content: [{ type: "input_text", text: "compact" }] }],
		promptInputSource: "reconstructed",
		requestOptions: {},
		tokensBefore: 1_000,
		sessionId: `${model.provider}-compaction`,
	});

	assert.equal(result.ok, true);
	return requestedProviders;
}

const baseCompactionModel = {
	id: "gpt-5.6-sol",
	name: "GPT-5.6 Sol",
	api: "openai-codex-responses" as const,
	reasoning: true,
	input: ["text"] as Array<"text" | "image">,
	contextWindow: 272_000,
	maxTokens: 128_000,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

test("canonical alias compaction reuses the registered stock Codex stream with alias model credentials", async () => {
	const requestedProviders = await runCodexTransportCompaction({
		...baseCompactionModel,
		provider: "openai-codex-personal",
		baseUrl: "https://chatgpt.com/backend-api/codex",
	}, "alias-token");
	assert.deepEqual(requestedProviders, ["openai-codex"]);
});
