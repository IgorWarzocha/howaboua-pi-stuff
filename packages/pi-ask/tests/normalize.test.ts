import { describe, expect, test } from "bun:test";
import {
	normalizeAskInput,
	normalizeResponses,
	summarizeResponses,
} from "../ask/normalize.js";

describe("review prompt normalization", () => {
	test("keeps a trimmed body and choices", () => {
		const { delivery, handoff, prompts } = normalizeAskInput({
			delivery: "steer",
			prompts: [
				{
					title: " Delivery can duplicate ",
					body: " Evidence and recommendation. ",
					choices: [{ label: " Fix " }],
				},
			],
		});

		expect(delivery).toBe("steer");
		expect(handoff).toBe(false);
		expect(prompts).toEqual([
			{
				id: "p1",
				title: "Delivery can duplicate",
				body: "Evidence and recommendation.",
				multiple: false,
				choices: [{ label: "Fix" }],
			},
		]);
	});

	test("gives handoffs default statuses without replacing custom choices", () => {
		expect(
			normalizeAskInput({
				handoff: true,
				prompts: [{ title: "Authorize GitHub" }],
			}),
		).toEqual({
			delivery: "wait",
			handoff: true,
			prompts: [
				{
					id: "p1",
					title: "Authorize GitHub",
					multiple: false,
					choices: [{ label: "Done" }, { label: "Could not complete" }],
				},
			],
		});

		expect(
			normalizeAskInput({
				handoff: true,
				prompts: [
					{
						title: "Authorize GitHub",
						choices: [{ label: "Authorized" }, { label: "Cancel" }],
					},
				],
			}).prompts[0]?.choices,
		).toEqual([{ label: "Authorized" }, { label: "Cancel" }]);
	});
});

describe("response normalization", () => {
	const prompts = [{ id: "p1", title: "Delivery", choices: [] }];

	test("accepts structured responses with comments", () => {
		const responses = normalizeResponses(prompts, [
			{ id: "ignored", selections: ["Defer"], comment: " after logging " },
		]);

		expect(responses).toEqual([
			{ id: "p1", selections: ["Defer"], comment: "after logging" },
		]);
		expect(summarizeResponses(prompts, responses)).toBe(
			"Delivery: Defer\n  Comment: after logging",
		);
	});

	test("accepts selection arrays from injected composers", () => {
		expect(normalizeResponses(prompts, [["Fix"]])).toEqual([
			{ id: "p1", selections: ["Fix"] },
		]);
	});
});
