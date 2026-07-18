import { describe, expect, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import autoReasoningSelector, { applyReasoningFloor } from "../src/index.js";

type ThinkingLevel = ReturnType<ExtensionAPI["getThinkingLevel"]>;

type Handler = (...args: any[]) => unknown;

function setup(initialLevel: ThinkingLevel) {
	let level = initialLevel;
	let tool: any;
	const handlers = new Map<string, Handler>();
	const pi = {
		registerTool(value: unknown) {
			tool = value;
		},
		on(event: string, handler: Handler) {
			handlers.set(event, handler);
		},
		getThinkingLevel() {
			return level;
		},
		setThinkingLevel(next: ThinkingLevel) {
			level = next;
		},
	} as unknown as ExtensionAPI;
	autoReasoningSelector(pi);
	return {
		get level() {
			return level;
		},
		tool: () => tool,
		handler: (event: string) => handlers.get(event)!,
	};
}

describe("reasoning floor", () => {
	test("never lowers below the user's baseline", () => {
		expect(applyReasoningFloor("medium", "high")).toBe("high");
		expect(applyReasoningFloor("high", "max")).toBe("max");
		expect(applyReasoningFloor("high", "medium")).toBe("high");
	});

	test("preserves a max baseline across queued continuations", async () => {
		const state = setup("max");
		await state.handler("before_agent_start")({}, {});
		await state
			.tool()
			.execute("call", { level: "medium" }, undefined, undefined, {});
		expect(state.level).toBe("max");

		await state.handler("before_agent_start")({}, {});
		await state.handler("agent_settled")({}, {});
		expect(state.level).toBe("max");
	});

	test("can escalate and return to a medium baseline", async () => {
		const state = setup("medium");
		await state.handler("before_agent_start")({}, {});
		await state
			.tool()
			.execute("call", { level: "high" }, undefined, undefined, {});
		expect(state.level).toBe("high");
		await state
			.tool()
			.execute("call", { level: "low" }, undefined, undefined, {});
		expect(state.level).toBe("medium");
		await state.handler("agent_settled")({}, {});
		expect(state.level).toBe("medium");
	});

	test("warns about cache impact only once", async () => {
		const state = setup("medium");
		const notifications: unknown[][] = [];
		const ctx = {
			ui: {
				notify: (...args: unknown[]) => notifications.push(args),
			},
		};

		await state.handler("session_start")({}, ctx);
		await state.handler("session_start")({}, ctx);

		expect(notifications).toEqual([
			[
				"Auto Reasoning switches reasoning levels mid-session. This can cause prompt-cache misses and affect costs or quotas, depending on your provider. Use with caution.",
				"warning",
			],
		]);
	});
});
