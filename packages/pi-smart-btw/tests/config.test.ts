import { expect, test } from "bun:test";
import { normalizeThinkingLevel } from "../src/config.js";

test("accepts max thinking", () => {
	expect(normalizeThinkingLevel("max", "low")).toBe("max");
});
