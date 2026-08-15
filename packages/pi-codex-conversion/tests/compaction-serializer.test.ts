import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { buildNativeCompactionInput, injectPendingNativeWindowIntoPiCompactionRequest } from "../src/adapter/compaction/compaction.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import type { Model } from "@earendil-works/pi-ai";
import { serializeActiveSessionToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import {
	REALTIME_DELEGATION_MESSAGE_TYPE,
	REALTIME_VOICE_MESSAGE_TYPE,
} from "../src/voice/message-types.ts";

const model = {
	id: "gpt-5.1",
	provider: "openai-codex",
	api: "openai-codex-responses",
	baseUrl: "https://api.openai.com",
	reasoning: true,
	input: ["text", "image"],
} as Model<any>;

test("first native compaction sends the full active Pi context", () => {
	const entry = (id: string, parentId: string | null, content: string) => ({
		type: "message",
		id,
		parentId,
		timestamp: new Date(1).toISOString(),
		message: { role: "user", content, timestamp: 1 },
	});
	const old = entry("old", null, "superseded old context");
	const kept = entry("kept", "old", "exact kept context");
	const compaction = {
		type: "compaction",
		id: "pi-compaction",
		parentId: "kept",
		timestamp: new Date(2).toISOString(),
		summary: "Pi summary",
		firstKeptEntryId: "kept",
		tokensBefore: 100,
	};
	const tail = entry("tail", "pi-compaction", "exact live tail");

	const input = serializeActiveSessionToResponsesInput({
		model,
		entries: [old, kept, compaction, tail] as never,
		leafId: "tail",
	});
	const serialized = JSON.stringify(input);

	assert.match(serialized, /Pi summary/);
	assert.match(serialized, /exact kept context/);
	assert.match(serialized, /exact live tail/);
	assert.doesNotMatch(serialized, /superseded old context/);
});

test("native compaction excludes voice-only chatter but preserves Pi delegations", () => {
	const customEntry = (
		id: string,
		parentId: string | null,
		customType: string,
		content: string,
	) => ({
		type: "custom_message",
		id,
		parentId,
		timestamp: new Date(1).toISOString(),
		customType,
		content,
		display: false,
		details: {},
	});
	const chatter = customEntry(
		"chatter",
		null,
		REALTIME_VOICE_MESSAGE_TYPE,
		"voice-only conversation",
	);
	const delegation = customEntry(
		"delegation",
		"chatter",
		REALTIME_DELEGATION_MESSAGE_TYPE,
		"Pi-visible delegation",
	);

	const input = serializeActiveSessionToResponsesInput({
		model,
		entries: [chatter, delegation] as never,
		leafId: "delegation",
	});
	const serialized = JSON.stringify(input);

	assert.doesNotMatch(serialized, /voice-only conversation/);
	assert.match(serialized, /Pi-visible delegation/);
});

test("native compaction request routing reuses only the latest matching checkpoint", () => {
	const tailEntry = {
		type: "message",
		id: "tail",
		parentId: "checkpoint",
		timestamp: new Date(2).toISOString(),
		message: { role: "user", content: "exact live tail", timestamp: 2 },
	} as never;
	const checkpoint = {
		type: "compaction",
		id: "checkpoint",
		parentId: null,
		timestamp: new Date(1).toISOString(),
		summary: "shim",
		firstKeptEntryId: "tail",
		tokensBefore: 100,
		details: { compactedWindow: [{ type: "compaction", encrypted_content: "sealed" }] },
	} as never;
	const common = {
		model,
		branchEntries: [checkpoint, tailEntry],
		allEntries: [checkpoint, tailEntry],
		leafId: "tail",
	};

	const matching = buildNativeCompactionInput({
		...common,
		latestNativeCompaction: { ok: true, entry: checkpoint, index: 0, latestCompactionIndex: 0 },
	});
	assert.equal(matching?.compactedKeptWindow, false);
	assert.equal((matching?.input[0] as { encrypted_content: string }).encrypted_content, "sealed");
	assert.match(JSON.stringify(matching?.input), /exact live tail/);

	const mismatched = buildNativeCompactionInput({
		...common,
		latestNativeCompaction: { ok: false, reason: "latest-native-compaction-mismatch", latestCompactionIndex: 0, latestCompaction: checkpoint },
	});
	assert.equal(mismatched?.compactedKeptWindow, true);
	assert.doesNotMatch(JSON.stringify(mismatched?.input), /sealed/);
	assert.match(JSON.stringify(mismatched?.input), /exact live tail/);
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
		executionMode: DEFAULT_CODEX_CONVERSION_CONFIG.executionMode,
		codexTurnState: createCodexTurnState(),
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
