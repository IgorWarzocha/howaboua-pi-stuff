import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import {
	NATIVE_COMPACTION_STRATEGY,
	type NativeCompactionEntry,
} from "../src/adapter/compaction/types.ts";
import { buildRealtimeInitialItems } from "../src/voice/context.ts";
import { buildRealtimeCallRequest } from "../src/voice/conversation/session.ts";
import { createNativeVoiceContextSummary } from "../src/voice/native-context.ts";

test("voice startup projects clean text into V3 developer context", async () => {
	let history = "";
	const entries = [
		{
			type: "message",
			id: "user",
			parentId: null,
			timestamp: new Date(1).toISOString(),
			message: {
				role: "user",
				content: [{ type: "text", text: "Explain this repo" }],
				timestamp: 1,
			},
		},
		{
			type: "message",
			id: "working",
			parentId: "user",
			timestamp: new Date(2).toISOString(),
			message: {
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "private reasoning" },
					{ type: "text", text: "Checking files" },
					{ type: "toolCall", id: "call-1", name: "read", arguments: {} },
				],
				stopReason: "toolUse",
				timestamp: 2,
			},
		},
		{
			type: "message",
			id: "tool",
			parentId: "working",
			timestamp: new Date(3).toISOString(),
			message: {
				role: "toolResult",
				toolCallId: "call-1",
				toolName: "read",
				content: [{ type: "text", text: "large code dump" }],
				isError: false,
				timestamp: 3,
			},
		},
		{
			type: "message",
			id: "answer",
			parentId: "tool",
			timestamp: new Date(4).toISOString(),
			message: {
				role: "assistant",
				content: [{ type: "text", text: "It is a Pi extension monorepo." }],
				stopReason: "stop",
				timestamp: 4,
			},
		},
	];
	const provider = {
		async *streamSimple(_model: unknown, context: unknown) {
			history = (
				context as { messages: Array<{ content: Array<{ text: string }> }> }
			).messages[0]!.content[0]!.text;
			yield {
				type: "done",
				message: { content: [{ type: "text", text: "summary" }] },
			};
		},
	};
	const initialItems = await buildRealtimeInitialItems({
		ctx: {
			sessionManager: {
				getEntries: () => entries,
				getBranch: () => entries,
				getLeafId: () => "answer",
				getSessionId: () => "clean-summary-input",
			},
			modelRegistry: {
				find: () => ({
					provider: "example",
					id: "text-model",
					maxTokens: 4_096,
				}),
				getProvider: () => provider,
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token" }),
			},
		} as never,
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			voice: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.voice,
				contextModel: { provider: "example", modelId: "text-model" },
			},
		},
	});

	assert.match(history, /\[User\]: Explain this repo/);
	assert.match(history, /\[Assistant\]: It is a Pi extension monorepo\./);
	assert.doesNotMatch(history, /private reasoning|Checking files|large code dump/);
	assert.equal(initialItems?.[0]?.role, "developer");
	assert.match(
		initialItems?.[0]?.content[0]?.text ?? "",
		/<startup_context>\nsummary\n<\/startup_context>/,
	);
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

test("native voice startup replays its checkpoint through an isolated sidecar", async () => {
	let payload: Record<string, unknown> | undefined;
	let sidecarContext: Record<string, unknown> | undefined;
	let sidecarModel: Record<string, unknown> | undefined;
	let sidecarSessionId: string | undefined;
	const model: Record<string, unknown> = {
		provider: "openai-codex",
		api: "openai-codex-responses",
		id: "gpt-5.4-mini",
		baseUrl: "https://catalog.example/backend-api",
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
			requestModel: unknown,
			context: unknown,
			options: {
				onPayload?: (value: unknown) => unknown;
				sessionId?: string;
			},
		) {
			sidecarModel = requestModel as Record<string, unknown>;
			sidecarContext = context as Record<string, unknown>;
			sidecarSessionId = options.sessionId;
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
			getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "token", baseUrl: "https://chatgpt.com/backend-api" }),
		},
	};
	const summary = await createNativeVoiceContextSummary({
		ctx: ctx as never,
		model: { provider: "openai-codex", modelId: "gpt-5.4-mini" },
		systemPrompt: "Summarize",
		request: "Create summary",
	});

	assert.equal(summary, "Readable continuity");
	assert.equal(sidecarModel?.["baseUrl"], "https://chatgpt.com/backend-api");
	assert.equal(sidecarContext?.["tools"], undefined);
	assert.notEqual(sidecarSessionId, "main-session");
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
});
