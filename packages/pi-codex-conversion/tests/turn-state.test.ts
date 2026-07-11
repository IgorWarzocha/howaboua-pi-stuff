import test from "node:test";
import assert from "node:assert/strict";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

test("turn state keeps the first server token until the logical turn resets", () => {
	const state = createCodexTurnState();
	state.capture("ts-1");
	state.capture("ts-2");
	assert.equal(state.current(), "ts-1");
	state.reset();
	assert.equal(state.current(), undefined);
});

test("a prewarm token seeds exactly one logical turn", () => {
	const state = createCodexTurnState();
	state.capturePrewarm("ts-warm");
	state.beginTurn();
	assert.equal(state.current(), "ts-warm");
	state.beginTurn();
	assert.equal(state.current(), undefined);
});
