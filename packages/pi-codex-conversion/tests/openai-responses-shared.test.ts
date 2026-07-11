import test from "node:test";
import assert from "node:assert/strict";
import { convertResponsesMessages, processResponsesStream } from "../src/providers/openai-responses/shared.ts";

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

test("convertResponsesMessages preserves PATH view_image as structured tool image output", () => {
	const imageModel = { ...model, input: ["text", "image"] as Array<"text" | "image"> };
	const messages = convertResponsesMessages(
		imageModel,
		{
			messages: [
				{
					role: "toolResult",
					toolCallId: "call_image|fc_image",
					content: [
						{ type: "text", text: "Command completed\nOutput:\n<image output>" },
						{ type: "image", mimeType: "image/png", data: "AAA", detail: "original" },
					],
				} as any,
			],
		},
		new Set(["openai-codex"]),
	);

	assert.deepEqual(messages, [
		{
			type: "function_call_output",
			call_id: "call_image",
			output: [
				{ type: "input_text", text: "Command completed\nOutput:\n<image output>" },
				{ type: "input_image", detail: "original", image_url: "data:image/png;base64,AAA" },
			],
		},
	]);
});
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

test("processResponsesStream preserves image generation calls for later Responses turns", async () => {
	const output = createAssistantOutput();
	const rawImageItem = {
		type: "image_generation_call",
		id: "ig_123",
		status: "completed",
		result: Buffer.from("png-bytes").toString("base64"),
		action: "edit",
		background: "opaque",
		output_format: "png",
		quality: "high",
		revised_prompt: "A tiny red square icon",
	};
	const imageItem = {
		type: "image_generation_call",
		id: "ig_123",
		status: "completed",
		result: Buffer.from("png-bytes").toString("base64"),
		revised_prompt: "A tiny red square icon",
	};

	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "image_generation_call", id: "ig_123", status: "in_progress" },
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: rawImageItem,
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
		{ push: () => undefined } as any,
		model,
	);

	assert.deepEqual((output.content as any[]).filter((block) => block.type === "image_generation_call"), [
		{ type: "image_generation_call", item: imageItem },
	]);

	const messages = convertResponsesMessages(
		model,
		{ messages: [output as any] },
		new Set(["openai-codex"]),
	);

	assert.deepEqual(messages, [imageItem]);
});
