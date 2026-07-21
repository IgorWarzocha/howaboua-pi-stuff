import { expect, test } from "bun:test";
import { parseRescueConfig, RESCUE_DEFAULTS } from "../src/config.js";

test("parses rescue settings and rejects invalid reasoning through defaults", () => {
	expect(
		parseRescueConfig({
			provider: " google ",
			model: "gemini-flash",
			reasoning: "minimal",
		}),
	).toEqual({
		provider: "google",
		model: "gemini-flash",
		reasoning: "minimal",
	});

	expect(parseRescueConfig({ reasoning: "turbo" })).toEqual({
		provider: undefined,
		model: undefined,
		reasoning: RESCUE_DEFAULTS.reasoning,
	});
});
