import { describe, expect, test } from "bun:test";
import type { PendingAskUpdate } from "../ask/pending.js";
import { createAskTool } from "../ask/tool.js";

const context = { hasUI: false, mode: "print" } as never;

describe("ask tool results", () => {
	test("returns waiting responses and keeps handoff dismissal distinct", async () => {
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

		const handoff = createAskTool({
			askInComposer: async () => null,
		});

		const dismissed = await handoff.execute(
			"call-2",
			{ handoff: true, prompts: [{ title: "Authorize GitHub" }] },
			undefined,
			undefined,
			context,
		);

		expect(dismissed.content).toEqual([
			{ type: "text", text: "Handoff dismissed by user." },
		]);
		expect(dismissed.details).toEqual({
			dismissed: true,
			kind: "handoff",
		});
	});

	test("acknowledges, serializes, and delivers steering asks", async () => {
		const presentations: string[] = [];
		const resolvers: Array<(value: unknown) => void> = [];
		const deliveries: string[] = [];
		const deliveryWaiters: Array<() => void> = [];
		const pendingUpdates: PendingAskUpdate[] = [];
		const tool = createAskTool({
			askInComposer: async (prompts) => {
				presentations.push(prompts[0]?.title ?? "");
				return await new Promise<unknown>((resolve) => resolvers.push(resolve));
			},
			deliverSteer: (message) => {
				deliveries.push(message);
				deliveryWaiters.shift()?.();
			},
			onPendingChange: (update) => pendingUpdates.push(update),
		});

		const first = await tool.execute(
			"steer-1",
			{
				delivery: "steer",
				prompts: [{ title: "First", choices: [{ label: "Yes" }] }],
			},
			undefined,
			undefined,
			context,
		);
		const second = await tool.execute(
			"steer-2",
			{ delivery: "steer", prompts: [{ title: "Second" }] },
			undefined,
			undefined,
			context,
		);
		await Promise.resolve();

		expect(first).toEqual({
			content: [
				{
					type: "text",
					text: "Question presented. Continue working; the response will arrive as user steering.",
				},
			],
			details: { kind: "prompt", pending: true, id: "steer-1" },
		});
		expect(second.details).toEqual({
			kind: "prompt",
			pending: true,
			id: "steer-2",
		});
		expect(presentations).toEqual(["First"]);

		const firstDelivery = new Promise<void>((resolve) =>
			deliveryWaiters.push(resolve),
		);
		resolvers[0]?.([{ selections: ["Yes"], comment: "Proceed." }]);
		await firstDelivery;
		await Promise.resolve();
		expect(presentations).toEqual(["First", "Second"]);

		const secondDelivery = new Promise<void>((resolve) =>
			deliveryWaiters.push(resolve),
		);
		resolvers[1]?.(null);
		await secondDelivery;

		expect(deliveries).toEqual([
			"Response to your earlier ask:\nFirst: Yes\n  Comment: Proceed.",
			"I dismissed your earlier ask: Second",
		]);
		expect(pendingUpdates.map(({ state, id }) => ({ state, id }))).toEqual([
			{ state: "pending", id: "steer-1" },
			{ state: "pending", id: "steer-2" },
			{ state: "closed", id: "steer-1" },
			{ state: "closed", id: "steer-2" },
		]);
		expect(pendingUpdates[0]).toMatchObject({
			prompts: [{ title: "First" }],
		});

		await expect(
			tool.execute(
				"steer-handoff",
				{
					delivery: "steer",
					handoff: true,
					prompts: [{ title: "Authorize" }],
				},
				undefined,
				undefined,
				context,
			),
		).rejects.toThrow("ask handoffs require delivery wait.");
	});
});
