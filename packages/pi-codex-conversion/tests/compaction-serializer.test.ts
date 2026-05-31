import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/config.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest } from "../src/adapter/compaction.ts";
import type { AdapterState } from "../src/adapter/state.ts";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import { serializeMessagesToCompactRequest, serializeMessagesToResponsesInput } from "../src/adapter/serializer.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

test("compaction serializer gives unsigned assistant text blocks unique fallback ids", () => {
	const input = serializeMessagesToResponsesInput(model, [
		{
			role: "assistant",
			provider: "openai-codex",
			api: "openai-codex-responses",
			model: "gpt-5.1",
			content: [
				{ type: "text", text: "one" },
				{ type: "text", text: "two" },
			],
			stopReason: "stop",
			timestamp: Date.now(),
		} as unknown as AgentMessage,
	]);

	assert.deepEqual(input.map((item) => (item as { id?: string }).id), ["msg_pi_0", "msg_pi_0_1"]);
});

test("compaction serializer preserves image generation call blocks", () => {
	const imageCall = {
		type: "image_generation_call",
		item: { type: "image_generation_call", id: "ig_1", status: "completed", result: null },
	};
	const input = serializeMessagesToResponsesInput(model, [
		{
			role: "assistant",
			provider: "openai-codex",
			api: "openai-codex-responses",
			model: "gpt-5.1",
			content: [imageCall],
			stopReason: "stop",
			timestamp: Date.now(),
		} as unknown as AgentMessage,
	]);

	assert.deepEqual(input, [imageCall.item]);
});

test("compaction serializer honors blocked image conversion", () => {
	const input = serializeMessagesToResponsesInput(model, [
		{
			role: "user",
			content: [{ type: "image", data: "abc", mimeType: "image/png" }],
			timestamp: Date.now(),
		} as unknown as AgentMessage,
	], { blockImages: true });

	assert.deepEqual(input, [{ role: "user", content: [{ type: "input_text", text: "Image reading is disabled." }] }]);
});

test("native compaction requests use Codex-compatible compact payload shape", () => {
	const request = serializeMessagesToCompactRequest({
		model,
		messages: [],
		instructions: "compact",
	});

	assert.deepEqual(Object.keys(request).sort(), ["input", "instructions", "model"]);
});

test("injects pending native compacted window into Pi compaction summarization payload", async () => {
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }) },
	} as any;
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, responsesCompaction: true },
		pendingPiCompactionNativeWindow: {
			window: [{ type: "compaction_summary", encrypted_content: "sealed" }],
			provider: model.provider,
			api: model.api,
			baseUrl: model.baseUrl as string,
			sessionId: "session-1",
		},
	};
	const payload = {
		model: model.id,
		input: [
			{ role: "developer", content: "You are a context summarization assistant. ONLY output the structured summary." },
			{ role: "user", content: [{ type: "input_text", text: "<conversation>hello</conversation>" }] },
		],
	};

	const rewritten = await injectPendingNativeWindowIntoPiCompactionRequest(payload, ctx, state) as typeof payload;
	assert.deepEqual(rewritten.input.map((item) => (item as { type?: string; role?: string }).type ?? (item as { role?: string }).role), ["developer", "compaction_summary", "user"]);
	assert.equal(state.pendingPiCompactionNativeWindow, undefined);
});

test("does not inject pending native compacted window into normal Responses requests", async () => {
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "session-1" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }) },
	} as any;
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, responsesCompaction: true },
		pendingPiCompactionNativeWindow: {
			window: [{ type: "compaction_summary", encrypted_content: "sealed" }],
			provider: model.provider,
			api: model.api,
			baseUrl: model.baseUrl as string,
			sessionId: "session-1",
		},
	};
	const payload = { model: model.id, input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] };

	assert.equal(await injectPendingNativeWindowIntoPiCompactionRequest(payload, ctx, state), undefined);
	assert.equal(state.pendingPiCompactionNativeWindow?.window.length, 1);
});

test("clears pending native compacted window for a different session", async () => {
	const ctx = {
		model,
		sessionManager: { getSessionId: () => "session-2" },
		modelRegistry: { getApiKeyAndHeaders: async () => ({ ok: true as const, apiKey: "key" }) },
	} as any;
	const state: AdapterState = {
		enabled: true,
		cwd: process.cwd(),
		promptSkills: [],
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, responsesCompaction: true },
		pendingPiCompactionNativeWindow: {
			window: [{ type: "compaction_summary", encrypted_content: "sealed" }],
			provider: model.provider,
			api: model.api,
			baseUrl: model.baseUrl as string,
			sessionId: "session-1",
		},
	};
	const payload = { model: model.id, input: [{ role: "user", content: [{ type: "input_text", text: "hello" }] }] };

	assert.equal(await injectPendingNativeWindowIntoPiCompactionRequest(payload, ctx, state), undefined);
	assert.equal(state.pendingPiCompactionNativeWindow, undefined);
});
