import { describe, expect, test } from "bun:test";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import {
	cacheLaneKey,
	predictCacheHit,
	scanCacheHistory,
} from "../src/predictor.js";

let nextId = 0;

function base(type: string) {
	nextId += 1;
	return {
		type,
		id: nextId.toString(16).padStart(8, "0"),
		parentId: nextId === 1 ? null : (nextId - 1).toString(16).padStart(8, "0"),
		timestamp: new Date(nextId * 1_000).toISOString(),
	};
}

function thinking(level: string): SessionEntry {
	return {
		...base("thinking_level_change"),
		type: "thinking_level_change",
		thinkingLevel: level,
	};
}

function assistant(
	model: string,
	prompt: number,
	timestamp: number,
	cacheRead = 0,
): SessionEntry {
	return {
		...base("message"),
		type: "message",
		message: {
			role: "assistant",
			content: [],
			api: "openai-responses",
			provider: "openai",
			model,
			usage: {
				input: prompt - cacheRead,
				output: 10,
				cacheRead,
				cacheWrite: 0,
				totalTokens: prompt + 10,
				cost: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 0,
				},
			},
			stopReason: "stop",
			timestamp,
		},
	} as SessionEntry;
}

describe("cache lane history", () => {
	test("uses the live reasoning level when old sessions have no initial entry", () => {
		const history = scanCacheHistory(
			[assistant("gpt-test", 25_000, 1_000, 8_000)],
			"medium",
		);

		expect([...history.lanes.values()][0]?.thinkingLevel).toBe("medium");
	});

	test("keeps separate snapshots for reasoning levels", () => {
		const history = scanCacheHistory([
			thinking("low"),
			assistant("gpt-test", 25_000, 1_000, 8_000),
			thinking("high"),
			assistant("gpt-test", 100_000, 2_000, 24_000),
		]);

		expect(history.lanes.size).toBe(2);
		expect(
			history.lanes.get(
				cacheLaneKey({
					provider: "openai",
					api: "openai-responses",
					model: "gpt-test",
					thinkingLevel: "low",
				}),
			)?.promptTokens,
		).toBe(25_000);
	});

	test("drops incompatible pre-compaction snapshots", () => {
		const compaction = {
			...base("compaction"),
			type: "compaction",
			summary: "summary",
			firstKeptEntryId: "00000001",
			tokensBefore: 50_000,
		} as SessionEntry;
		const history = scanCacheHistory([
			thinking("low"),
			assistant("gpt-old", 50_000, 1_000, 20_000),
			compaction,
			assistant("gpt-new", 10_000, 2_000, 0),
		]);

		expect(history.lanes.size).toBe(1);
		expect([...history.lanes.values()][0]?.model).toBe("gpt-new");
	});
});

describe("cache hit prediction", () => {
	test("bounds the old lane prefix by the current prompt", () => {
		const history = scanCacheHistory([
			thinking("low"),
			assistant("gpt-test", 25_000, 1_000, 8_000),
		]);
		const prediction = predictCacheHit(
			history,
			{
				provider: "openai",
				api: "openai-responses",
				model: "gpt-test",
				thinkingLevel: "low",
			},
			100_000,
		);

		expect(prediction.estimatedCacheTokens).toBe(25_000);
		expect(prediction.percent).toBe(25);
	});

	test("reports an unseen destination as cold", () => {
		const history = scanCacheHistory([
			thinking("high"),
			assistant("gpt-test", 100_000, 1_000, 20_000),
		]);
		const prediction = predictCacheHit(
			history,
			{
				provider: "openai",
				api: "openai-responses",
				model: "gpt-test",
				thinkingLevel: "low",
			},
			100_000,
		);

		expect(prediction.hasLaneHistory).toBe(false);
		expect(prediction.estimatedCacheTokens).toBe(0);
		expect(prediction.percent).toBe(0);
	});
});
