import { describe, expect, test } from "bun:test";
import { createAskTool } from "../ask/tool.js";

const context = { hasUI: false, mode: "print" } as never;

describe("ask tool results", () => {
	test("serializes interactive calls", () => {
		expect(createAskTool().executionMode).toBe("sequential");
	});

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
		const blockedStates: Array<{ active: boolean; label: string }> = [];
		const tool = createAskTool({
			askInComposer: async () => null,
			onBlockedChange: (state) => blockedStates.push(state),
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
		expect(blockedStates).toEqual([
			{ active: true, label: "Human action needed" },
			{ active: false, label: "Human action needed" },
		]);
	});

	test("clears blocked state when the prompt UI fails", async () => {
		const blockedStates: Array<{ active: boolean; label: string }> = [];
		const tool = createAskTool({
			askInComposer: async () => {
				throw new Error("UI unavailable");
			},
			onBlockedChange: (state) => blockedStates.push(state),
		});

		const execution = tool.execute(
			"call-3",
			{ prompts: [{ title: "Choose a path" }] },
			undefined,
			undefined,
			context,
		);

		await expect(execution).rejects.toThrow("UI unavailable");
		expect(blockedStates).toEqual([
			{ active: true, label: "Waiting for input" },
			{ active: false, label: "Waiting for input" },
		]);
	});
});
