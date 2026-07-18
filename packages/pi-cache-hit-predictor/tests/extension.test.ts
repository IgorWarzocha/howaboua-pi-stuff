import { expect, test } from "bun:test";
import type {
	ExtensionAPI,
	ExtensionContext,
	SessionEntry,
} from "@earendil-works/pi-coding-agent";
import cacheHitPredictor from "../index.js";

test("coalesces a model clamp into one inline notification", async () => {
	const handlers = new Map<
		string,
		(event: never, ctx: ExtensionContext) => unknown
	>();
	const notifications: string[] = [];
	const pi = {
		on(
			event: string,
			handler: (event: never, ctx: ExtensionContext) => unknown,
		) {
			handlers.set(event, handler);
		},
		getThinkingLevel: () => "high",
	} as unknown as ExtensionAPI;

	cacheHitPredictor(pi);

	const branch = [
		{
			type: "thinking_level_change",
			id: "00000001",
			parentId: null,
			timestamp: new Date(1_000).toISOString(),
			thinkingLevel: "low",
		},
		{
			type: "message",
			id: "00000002",
			parentId: "00000001",
			timestamp: new Date(2_000).toISOString(),
			message: {
				role: "assistant",
				content: [],
				api: "openai-responses",
				provider: "openai",
				model: "gpt-old",
				usage: {
					input: 17_000,
					output: 10,
					cacheRead: 8_000,
					cacheWrite: 0,
					totalTokens: 25_010,
					cost: {
						input: 0,
						output: 0,
						cacheRead: 0,
						cacheWrite: 0,
						total: 0,
					},
				},
				stopReason: "stop",
				timestamp: 2_000,
			},
		},
	] as SessionEntry[];
	const oldModel = {
		provider: "openai",
		api: "openai-responses",
		id: "gpt-old",
		name: "Old",
		baseUrl: "https://api.openai.com/v1",
		reasoning: true,
		input: ["text"],
		cost: { input: 1, output: 1, cacheRead: 0.1, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 10_000,
	} as const;
	const newModel = { ...oldModel, id: "gpt-new", name: "New" };
	const ctx = {
		mode: "tui",
		model: newModel,
		getContextUsage: () => ({
			tokens: 100_000,
			contextWindow: 200_000,
			percent: 50,
		}),
		sessionManager: { getBranch: () => branch },
		modelRegistry: { find: () => undefined },
		ui: {
			notify(message: string) {
				notifications.push(message);
			},
		},
	} as unknown as ExtensionContext;

	await handlers.get("session_start")?.({} as never, ctx);
	await handlers.get("thinking_level_select")?.(
		{ level: "high", previousLevel: "low" } as never,
		ctx,
	);
	await handlers.get("model_select")?.(
		{
			model: newModel,
			previousModel: oldModel,
			source: "set",
		} as never,
		ctx,
	);
	expect(notifications).toHaveLength(0);
	await Bun.sleep(5);

	expect(notifications).toEqual([
		"Cache hit prediction · gpt-new · high: cold lane (0% of ~100k)",
	]);
});
