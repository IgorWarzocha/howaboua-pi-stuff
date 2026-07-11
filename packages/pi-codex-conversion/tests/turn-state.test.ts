import test from "node:test";
import assert from "node:assert/strict";
import { createCodexTurnState, extractCodexTurnStateFromWebSocketEvent } from "../src/providers/openai-codex/turn-state.ts";

test("turn state keeps the first server token until the logical turn resets", () => {
	const state = createCodexTurnState();
	state.capture("ts-1");
	state.capture("ts-2");
	assert.equal(state.current(), "ts-1");
	state.reset();
	assert.equal(state.current(), undefined);
});

test("turn state reads WebSocket response metadata headers", () => {
	for (const type of ["response.metadata", "codex.response.metadata"]) {
		assert.equal(extractCodexTurnStateFromWebSocketEvent({
			type,
			headers: { "X-Codex-Turn-State": "ts-ws" },
		}), "ts-ws");
	}
});
