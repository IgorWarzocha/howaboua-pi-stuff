import { describe, expect, test } from "bun:test";
import { createAskTool } from "../ask/tool.js";

const context = { hasUI: false, mode: "print" } as never;

describe("ask tool results", () => {
	test("returns review dispositions in model-visible content", async () => {
		const tool = createAskTool({
			askInComposer: async () => [
				{ selections: ["Defer"], comment: "After the release." },
			],
		});

		const result = await tool.execute(
			"call-1",
			{
				prompts: [
					{
						title: "Delivery can duplicate",
						body: "Two paths enqueue the same delivery.",
						choices: [{ label: "Fix" }, { label: "Defer" }],
					},
				],
			},
			undefined,
			undefined,
			context,
		);

		expect(result.content).toEqual([
			{
				type: "text",
				text: "Delivery can duplicate: Defer\n  Comment: After the release.",
			},
		]);
		expect(result.details).toEqual({
			kind: "prompt",
			responses: [
				{
					id: "p1",
					selections: ["Defer"],
					comment: "After the release.",
				},
			],
		});
	});

	test("keeps a dismissed handoff distinct from a response", async () => {
		const tool = createAskTool({
			askInComposer: async () => null,
		});

		const result = await tool.execute(
			"call-2",
			{ handoff: true, prompts: [{ title: "Authorize GitHub" }] },
			undefined,
			undefined,
			context,
		);

		expect(result.content).toEqual([
			{ type: "text", text: "Handoff dismissed by user." },
		]);
		expect(result.details).toEqual({
			dismissed: true,
			kind: "handoff",
		});
	});
});
