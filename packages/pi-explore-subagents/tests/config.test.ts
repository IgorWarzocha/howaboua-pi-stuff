import { expect, test } from "bun:test";
import { normalizeConfig } from "../src/config.js";

test("accepts max thinking", () => {
	expect(
		normalizeConfig(
			{ model: "provider/model", thinking: "max" },
			{ model: "fallback/model", thinking: "low" },
		),
	).toEqual({ model: "provider/model", thinking: "max" });
});
