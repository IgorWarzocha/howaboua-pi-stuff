import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import {
	NATIVE_COMPACTION_STRATEGY,
	type NativeCompactionEntry,
} from "../src/adapter/compaction/types.ts";
import { createNativeVoiceContextSummary } from "../src/voice/native-context.ts";
import { buildRealtimeCallRequest } from "../src/voice/conversation/session.ts";

test("V3 voice setup pins acknowledgements and seeded context", () => {
	const initialItems = [
		{
			type: "message" as const,
			role: "developer" as const,
			content: [{ type: "input_text" as const, text: "summary" }],
		},
	];
	const request = buildRealtimeCallRequest(
		"offer",
		DEFAULT_CODEX_CONVERSION_CONFIG,
		"instructions",
		initialItems,
	);
	assert.deepEqual(request.session.delegation, {
		type: "client",
		ack_filler: true,
	});
	assert.deepEqual(request.session.initial_items, initialItems);
});

test("native voice context keeps the encrypted checkpoint on its provider lane", async () => {
	let payload: Record<string, unknown> | undefined;
	let sidecarContext: Record<string, unknown> | undefined;
	let model: Record<string, unknown> = {
		provider: "openai-codex",
		api: "openai-codex-responses",
		id: "gpt-5.4-mini",
		baseUrl: "https://chatgpt.com/backend-api",
		contextWindow: 100_000,
		maxTokens: 8_192,
		input: ["text"],
	};
	const checkpoint: NativeCompactionEntry = {
		type: "compaction",
		id: "checkpoint",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		summary: "[OpenAI native compaction checkpoint]",
		firstKeptEntryId: "checkpoint",
		tokensBefore: 10_000,
		details: {
			strategy: NATIVE_COMPACTION_STRATEGY,
			provider: "openai-codex",
			api: "openai-codex-responses",
			model: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api",
			createdAt: new Date(1).toISOString(),
			compactedWindow: [
				{ type: "compaction", encrypted_content: "sealed-checkpoint" },
			],
		},
	};
	const provider = {
		async *streamSimple(
			_model: unknown,
			context: unknown,
			options: { onPayload?: (value: unknown) => unknown },
		) {
			sidecarContext = context as Record<string, unknown>;
			payload = options.onPayload?.({
				model: "gpt-5.4-mini",
				input: [
					{
						role: "user",
						content: [{ type: "input_text", text: "Create summary" }],
					},
				],
			}) as Record<string, unknown>;
			yield {
				type: "done",
				message: {
					content: [{ type: "text", text: "Readable continuity" }],
				},
			};
		},
	};
	const ctx = {
		sessionManager: {
			getBranch: () => [checkpoint],
			getSessionId: () => "main-session",
		},
		modelRegistry: {
			find: () => model,
			getProvider: () => provider,
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token" }),
		},
	};
	const summary = await createNativeVoiceContextSummary({
		ctx: ctx as never,
		model: { provider: "openai-codex", modelId: "gpt-5.4-mini" },
		systemPrompt: "Summarize",
		request: "Create summary",
	});

	assert.equal(summary, "Readable continuity");
	assert.equal(sidecarContext?.["tools"], undefined);
	assert.equal(payload?.["prompt_cache_key"], "main-session");
	assert.deepEqual(
		(payload?.["input"] as Array<Record<string, unknown>>).map(
			(item) => item["type"] ?? item["role"],
		),
		["compaction", "user"],
	);
	assert.equal(
		(payload?.["input"] as Array<Record<string, unknown>>)[0]?.[
			"encrypted_content"
		],
		"sealed-checkpoint",
	);

	model = { ...model, provider: "anthropic", api: "anthropic-messages" };
	await assert.rejects(
		createNativeVoiceContextSummary({
			ctx: ctx as never,
			model: { provider: "anthropic", modelId: "claude" },
			systemPrompt: "Summarize",
			request: "Create summary",
		}),
		/cannot read the latest native checkpoint/,
	);
});
