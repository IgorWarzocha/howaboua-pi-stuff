import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream, type AssistantMessage } from "@earendil-works/pi-ai";
import { processResponsesStream } from "../src/providers/openai-responses/shared.ts";
import { assertSuccessfulCodexOutput, processCodexResponsesStream } from "../src/providers/openai-codex/stream-events.ts";

const model = {
	id: "gpt-test",
	name: "Test Model",
	api: "openai-codex-responses",
	provider: "openai-codex",
	baseUrl: "https://example.com",
	reasoning: false,
	input: ["text"] as Array<"text" | "image">,
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 4096,
};

function createAssistantOutput(): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: model.id,
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "pending",
		timestamp: Date.now(),
	};
}

async function* asAsyncIterable<T>(values: T[]): AsyncIterable<T> {
	for (const value of values) {
		yield value;
	}
}

async function* interruptedAsyncIterable<T>(values: T[]): AsyncIterable<T> {
	for (const value of values) yield value;
	throw new Error("Request was aborted");
}

test("processResponsesStream keeps interleaved message items separate by output index", async () => {
	const output = createAssistantOutput();
	const pushedEvents: Array<{ type: string; contentIndex?: number }> = [];

	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "message", id: "msg_a", role: "assistant", status: "in_progress", content: [] },
			},
			{
				type: "response.content_part.added",
				output_index: 0,
				content_index: 0,
				item_id: "msg_a",
				part: { type: "output_text", text: "", annotations: [] },
			},
			{
				type: "response.output_item.added",
				output_index: 1,
				item: { type: "message", id: "msg_b", role: "assistant", status: "in_progress", content: [] },
			},
			{
				type: "response.content_part.added",
				output_index: 1,
				content_index: 0,
				item_id: "msg_b",
				part: { type: "output_text", text: "", annotations: [] },
			},
			{ type: "response.output_text.delta", output_index: 0, content_index: 0, item_id: "msg_a", delta: "Hello", logprobs: [] },
			{ type: "response.output_text.delta", output_index: 1, content_index: 0, item_id: "msg_b", delta: "World", logprobs: [] },
			{
				type: "response.output_item.done",
				output_index: 0,
				item: { type: "message", id: "msg_a", role: "assistant", status: "completed", content: [{ type: "output_text", text: "Hello", annotations: [] }] },
			},
			{
				type: "response.output_item.done",
				output_index: 1,
				item: { type: "message", id: "msg_b", role: "assistant", status: "completed", content: [{ type: "output_text", text: "World", annotations: [] }] },
			},
			{
				type: "response.completed",
				response: {
					id: "resp_1",
					status: "completed",
					usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 } },
				},
			},
		]) as AsyncIterable<any>,
		output as any,
		{ push: (event: { type: string; contentIndex?: number }) => pushedEvents.push(event) } as any,
		model,
	);

	assert.deepEqual(
		(output.content as Array<{ type: string; text?: string }>).map((block) => (block.type === "text" ? block.text : undefined)),
		["Hello", "World"],
	);
	assert.deepEqual(
		pushedEvents.filter((event) => event.type === "text_start").map((event) => event.contentIndex),
		[0, 1],
	);
});

test("Responses terminal events preserve raw observations and price reported usage", async () => {
	const output = { ...createAssistantOutput(), errorMessage: "stale incomplete response" };
	await processResponsesStream(
		asAsyncIterable([{
			type: "response.completed",
			response: {
				id: "resp_usage",
				status: "completed",
				usage: {
					input_tokens: 20,
					output_tokens: 8,
					total_tokens: 28,
					input_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 },
					output_tokens_details: { reasoning_tokens: 6 },
				},
			},
		}]) as AsyncIterable<any>,
		output as any,
		{ push: () => undefined } as any,
		model,
	);

	assert.deepEqual(output.usage, {
		input: 12,
		output: 8,
		cacheRead: 5,
		cacheWrite: 3,
		reasoning: 6,
		totalTokens: 28,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	});
	assert.equal(output.errorMessage, undefined);
	for (const [serviceTier, multiplier] of [["default", 1], ["priority", 2], ["fast", 2], ["flex", 0.5]] as const) {
		const priced = createAssistantOutput();
		const pricedModel = { ...model, cost: { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 } };
		const raw = { type: "response.done", response: { status: "completed", service_tier: serviceTier,
			usage: { input_tokens: 20, output_tokens: 8, total_tokens: 28, input_tokens_details: { cached_tokens: 5, cache_write_tokens: 3 } } } };
		const observed: unknown[] = [];
		await processCodexResponsesStream(asAsyncIterable([raw]), priced, createAssistantMessageEventStream(), pricedModel, {
			onProviderStreamEvent: async (event, observedModel) => {
				assert.equal(observedModel, pricedModel);
				observed.push(event);
			},
		});
		assert.deepEqual(observed, [raw]);
		assertSuccessfulCodexOutput(priced);
		const expected = {
			input: 24 / 1e6 * multiplier, output: 80 / 1e6 * multiplier,
			cacheRead: 0.5 / 1e6 * multiplier, cacheWrite: 7.5 / 1e6 * multiplier,
			total: (24 / 1e6 + 80 / 1e6 + 0.5 / 1e6 + 7.5 / 1e6) * multiplier,
		};
		for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
			assert.ok(Math.abs(priced.usage.cost[key] - expected[key]) < 1e-15, `${serviceTier} ${key}`);
		}
	}
});

test("processResponsesStream retains finalized freeform input for execution and continuation", async () => {
	const output = createAssistantOutput();
	const completedItems: unknown[] = [];
	const toolCallDeltas: string[] = [];
	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_exec" } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "", namespace: "security" } },
			{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "canonical", sequence_number: 1 },
			{ type: "response.custom_tool_call_input.done", output_index: 0, item_id: "ctc_1", input: "canonical();", sequence_number: 2 },
			{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", status: "completed", namespace: "security" } },
			{ type: "response.completed", response: { id: "resp_exec", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0, input_tokens_details: { cached_tokens: 0 } } } },
		]) as AsyncIterable<any>,
		output as any,
		{
			push(event: { type: string; delta?: string }) {
				if (event.type === "toolcall_delta" && event.delta) toolCallDeltas.push(event.delta);
			},
		} as any,
		model,
		{
			grammarToolInputProperties: new Map([["exec", "code"]]),
			onOutputItemDone: (item) => completedItems.push(item),
		},
	);

	assert.deepEqual(output.content, [{ type: "toolCall", id: "call_1|ctc_1", name: "exec", arguments: { code: "canonical();" }, namespace: "security" }]);
	assert.equal(toolCallDeltas.join(""), JSON.stringify({ code: "canonical();" }));
	assert.deepEqual(completedItems, [{ type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", status: "completed", namespace: "security", input: "canonical();" }]);
});

test("Responses rejects ambiguous or unfinished tool calls and discards interrupted input", async () => {
	const output = createAssistantOutput();
	const pushedEvents: string[] = [];

	await assert.rejects(
		processResponsesStream(
			interruptedAsyncIterable([
				{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "" } },
				{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "unfinished", sequence_number: 1 },
			]) as AsyncIterable<any>,
			output as any,
			{ push: (event: { type: string }) => pushedEvents.push(event.type) } as any,
			model,
			{ grammarToolInputProperties: new Map([["exec", "code"]]) },
		),
		/Request was aborted/,
	);

	assert.ok(pushedEvents.includes("toolcall_start"));
	assert.deepEqual(output.content, []);
	for (const type of ["function_call", "custom_tool_call"] as const) {
		const item = { type, id: "item_1", call_id: "call_1", name: "example", arguments: "{}", input: "done" };
		const added = { type: "response.output_item.added", output_index: 0, item };
		const done = { type: "response.output_item.done", output_index: 0, item };
		const terminal = { type: "response.completed", response: { status: "completed" } };
		for (const events of [
			[added, terminal],
			[{ type: added.type, item }, { type: added.type, item: { ...item, id: "item_2", call_id: "call_2" } }, done, terminal],
			[added, { ...added, item: { ...item, id: "item_2", call_id: "call_2" } }, done, terminal],
			[added, { ...done, item: { ...item, call_id: "other" } }, terminal],
			[done, done, terminal],
		]) {
			const rejected = createAssistantOutput();
			await processCodexResponsesStream(asAsyncIterable(events), rejected, createAssistantMessageEventStream(), model, undefined);
			assert.equal(rejected.stopReason, "error");
			assert.throws(() => assertSuccessfulCodexOutput(rejected), /Invalid Responses tool stream/);
		}
		// A finalized item alone is a supported boundary, not an unfinished call.
		for (const events of [
			[done, terminal],
			[{ ...added, item: { ...item, id: undefined } }, { ...done, item: { ...item, id: undefined } }, terminal],
		]) {
			const finalized = createAssistantOutput();
			await processCodexResponsesStream(asAsyncIterable<typeof events[number]>(events), finalized, createAssistantMessageEventStream(), model, undefined);
			assert.equal(finalized.stopReason, "toolUse");
			assert.equal(finalized.content.length, 1);
		}
	}
});
