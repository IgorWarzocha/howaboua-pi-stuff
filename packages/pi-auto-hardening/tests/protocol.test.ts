import { describe, expect, test } from "bun:test";
import { parseWorkerDisposition } from "../src/protocol.js";

describe("worker disposition protocol", () => {
	test("accepts complete only as the final line", () => {
		expect(parseWorkerDisposition("Refactor finished.\n\n[complete]")).toEqual({
			status: "complete",
		});
		expect(parseWorkerDisposition("[complete]\nMore commentary")).toEqual({
			status: "incomplete",
		});
	});

	test("preserves a concrete blocker", () => {
		expect(
			parseWorkerDisposition(
				"Validation cannot run.\n[blocker] Required database is unavailable.",
			),
		).toEqual({
			status: "blocked",
			reason: "Required database is unavailable.",
		});
	});

	test("rejects an empty blocker and ordinary prose", () => {
		expect(parseWorkerDisposition("[blocker]")).toEqual({
			status: "incomplete",
		});
		expect(parseWorkerDisposition("Looks good to me.")).toEqual({
			status: "incomplete",
		});
	});
});
