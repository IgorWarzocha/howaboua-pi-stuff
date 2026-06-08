import test from "node:test";
import assert from "node:assert/strict";
import { formatCodexUsage } from "../src/codex-settings/usage.ts";

test("formatCodexUsage reports remaining quota, not consumed quota", () => {
	const text = formatCodexUsage({
		planType: "prolite",
		limits: [{
			limitId: "codex",
			primary: { usedPercent: 75, windowMinutes: 300 },
			secondary: { usedPercent: 20, windowMinutes: 10080 },
		}],
		raw: {},
	});

	assert.match(text, /5h: 25% left/);
	assert.match(text, /weekly: 80% left/);
	assert.doesNotMatch(text, /used/);
});
