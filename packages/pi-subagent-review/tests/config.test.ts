import { expect, test } from "bun:test";
import { normalizeThinking } from "../src/config.js";

test("accepts max thinking", () => {
	expect(normalizeThinking("max", "low")).toBe("max");
});
