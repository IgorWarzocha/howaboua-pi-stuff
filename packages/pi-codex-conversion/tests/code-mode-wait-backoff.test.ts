import assert from "node:assert/strict";
import test from "node:test";
import { adaptiveWaitMs } from "../src/tools/code-mode/public-tools.ts";

test("Code Mode wait grows repeated short polls to a five-minute ceiling", () => {
	assert.deepEqual(
		Array.from({ length: 8 }, (_, attempt) => adaptiveWaitMs(1_000, attempt)),
		[5_000, 10_000, 20_000, 40_000, 80_000, 160_000, 300_000, 300_000],
	);
});

test("Code Mode wait preserves explicit durations above the adaptive ceiling", () => {
	assert.equal(adaptiveWaitMs(600_000, 4), 600_000);
});
