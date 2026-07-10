import { expect, test } from "bun:test";
import {
	normalizeThinkingLevel,
	shouldDistillOnShutdown,
} from "../src/index.js";

test("accepts max thinking", () => {
	expect(normalizeThinkingLevel("max")).toBe("max");
});

test("falls back for unknown thinking levels", () => {
	expect(normalizeThinkingLevel("unlimited", "medium")).toBe("medium");
});

test("distills only when Pi quits", () => {
	expect(shouldDistillOnShutdown("quit")).toBe(true);
	for (const reason of ["reload", "new", "resume", "fork"]) {
		expect(shouldDistillOnShutdown(reason)).toBe(false);
	}
});
