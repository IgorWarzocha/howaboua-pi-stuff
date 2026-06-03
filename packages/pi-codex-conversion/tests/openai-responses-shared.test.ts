import test from "node:test";
import assert from "node:assert/strict";
import { convertResponsesMessages, processResponsesStream } from "../src/providers/openai-responses-shared.ts";

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

test("convertResponsesMessages gives fallback assistant text ids a per-block suffix", () => {
	const messages = convertResponsesMessages(
		model,
		{
			messages: [
				{
					role: "assistant",
					content: [
						{ type: "text", text: "first" },
						{ type: "text", text: "second" },
					],
					api: "openai-codex-responses",
					provider: "openai-codex",
					model: model.id,
					usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
					stopReason: "stop",
					timestamp: 0,
				},
			],
		},
		new Set(["openai-codex"]),
	);

	assert.deepEqual(
		messages.map((message) => (typeof message === "object" && message && "id" in message ? message.id : undefined)),
		["msg_pi_0", "msg_pi_0_1"],
	);
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

test("processResponsesStream preserves web search calls for later Responses turns", async () => {
	const output = createAssistantOutput();
	const webSearchItem = {
		type: "web_search_call",
		id: "ws_123",
		status: "completed",
		action: { type: "search", query: "BlackBerry 9700 Bold" },
		results: [{ title: "BlackBerry Bold 9700", url: "https://example.com/9700" }],
	};

	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "web_search_call", id: "ws_123", status: "in_progress" },
			},
			{
				type: "response.output_item.done",
				output_index: 0,
				item: webSearchItem,
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

	assert.deepEqual((output.content as any[]).filter((block) => block.type === "web_search_call"), [
		{ type: "web_search_call", item: webSearchItem },
	]);

	const messages = convertResponsesMessages(
		model,
		{ messages: [output as any] },
		new Set(["openai-codex"]),
	);

	assert.deepEqual(messages, [webSearchItem]);
});

test("convertResponsesMessages strips unsupported image generation call fields from old history", () => {
	const messages = convertResponsesMessages(
		model,
		{
			messages: [
				{
					...createAssistantOutput(),
					content: [
						{
							type: "image_generation_call",
							item: {
								type: "image_generation_call",
								id: "ig_legacy",
								status: "generating",
								result: "base64-image",
								revised_prompt: "diagram",
								action: "edit",
								background: "opaque",
								output_format: "png",
								quality: "high",
							},
						},
					],
				} as any,
			],
		},
		new Set(["openai-codex"]),
	);

	assert.deepEqual(messages, [
		{
			type: "image_generation_call",
			id: "ig_legacy",
			status: "generating",
			result: "base64-image",
			revised_prompt: "diagram",
		},
	]);
});

test("processResponsesStream does not persist in-progress image generation calls", async () => {
	const output = createAssistantOutput();

	await processResponsesStream(
		asAsyncIterable([
			{ type: "response.created", response: { id: "resp_1" } },
			{
				type: "response.output_item.added",
				output_index: 0,
				item: { type: "image_generation_call", id: "ig_123", status: "in_progress" },
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

	assert.deepEqual((output.content as any[]).filter((block) => block.type === "image_generation_call"), []);
});
