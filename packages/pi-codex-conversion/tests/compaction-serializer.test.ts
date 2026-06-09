import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { injectPendingNativeWindowIntoPiCompactionRequest } from "../src/adapter/compaction/compaction.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import type { Model } from "@earendil-works/pi-ai";
import { serializeMessagesToCompactRequest } from "../src/adapter/compaction/serializer.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

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
		config: { ...DEFAULT_CODEX_CONVERSION_CONFIG, compaction: { ...DEFAULT_CODEX_CONVERSION_CONFIG.compaction, responsesCompaction: true } },
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
