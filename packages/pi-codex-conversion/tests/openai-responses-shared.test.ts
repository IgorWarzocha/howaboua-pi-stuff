import test from "node:test";
import assert from "node:assert/strict";
import { processResponsesStream } from "../src/providers/openai-responses/shared.ts";

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

function createAssistantOutput() {
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
		stopReason: "stop",
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

test("processResponsesStream records cache writes and reasoning tokens", async () => {
	const output = createAssistantOutput();
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
});

test("processResponsesStream retains finalized freeform input for execution and continuation", async () => {
	const output = createAssistantOutput();
	const completedItems: unknown[] = [];
	const toolCallDeltas: string[] = [];
	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_exec" } },
			{ type: "response.output_item.added", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", input: "" } },
			{ type: "response.custom_tool_call_input.delta", output_index: 0, item_id: "ctc_1", delta: "canonical", sequence_number: 1 },
			{ type: "response.custom_tool_call_input.done", output_index: 0, item_id: "ctc_1", input: "canonical();", sequence_number: 2 },
			{ type: "response.output_item.done", output_index: 0, item: { type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", status: "completed" } },
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

	assert.deepEqual(output.content, [{ type: "toolCall", id: "call_1|ctc_1", name: "exec", arguments: { code: "canonical();" } }]);
	assert.equal(toolCallDeltas.join(""), JSON.stringify({ code: "canonical();" }));
	assert.deepEqual(completedItems, [{ type: "custom_tool_call", id: "ctc_1", call_id: "call_1", name: "exec", status: "completed", input: "canonical();" }]);
});

test("processResponsesStream omits an interrupted partial tool call from the final message", async () => {
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
});
