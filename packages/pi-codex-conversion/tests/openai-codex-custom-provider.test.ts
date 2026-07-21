import test from "node:test";
import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import {
	buildRequestBody,
	buildCachedWebSocketRequestBody,
	parseSSE,
	registerOpenAICodexCustomProvider,
} from "../src/providers/openai-codex-custom-provider.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { createCodexRequestId } from "../src/providers/openai-codex/headers.ts";
import { parseOpenAICodexDeviceAuthPollResponse } from "../src/providers/openai-codex/oauth.ts";

const exampleTool = {
	name: "example_tool",
	description: "Example tool",
	parameters: {
		type: "object",
		properties: { value: { type: "string" } },
		required: ["value"],
	},
} as never;

const searchToolsTool = {
	name: "search_tools",
	description: "Find and activate tools",
	parameters: {
		type: "object",
		properties: { query: { type: "string" } },
		required: ["query"],
	},
} as never;

const codeModeTools = [
	{ name: "exec", description: "Compose tools", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
	{ name: "wait", description: "Wait for code", parameters: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] } },
] as never;

const codexModel = {
	provider: "openai-codex",
	api: "openai-codex-responses",
	id: "gpt-5.4",
	input: ["text"],
	output: ["text"],
	reasoning: true,
	contextWindow: 272000,
	maxOutputTokens: 100000,
	cost: { input: 0, output: 0 },
} as never;

const toolLoadingMessages = [
	{ role: "user", content: "Find an example tool" },
	{
		role: "assistant",
		content: [{ type: "toolCall", id: "call_search|fc_search", name: "search_tools", arguments: { query: "example" } }],
		api: "openai-codex-responses",
		provider: "openai-codex",
		model: "gpt-5.4",
		stopReason: "toolUse",
		timestamp: 1,
	},
	{
		role: "toolResult",
		toolCallId: "call_search|fc_search",
		toolName: "search_tools",
		content: [{ type: "text", text: "Loaded tools: example_tool" }],
		addedToolNames: ["example_tool"],
		isError: false,
		timestamp: 2,
	},
] as never;

function fakeJwt(payload: Record<string, unknown>): string {
	return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}

function sseResponse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

test("Codex device auth preserves pending and slow-down responses", async () => {
	assert.deepEqual(
		await parseOpenAICodexDeviceAuthPollResponse(
			new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }),
		),
		{ status: "slow_down" },
	);
	assert.deepEqual(
		await parseOpenAICodexDeviceAuthPollResponse(
			new Response(
				JSON.stringify({
					error: { code: "deviceauth_authorization_pending" },
				}),
				{ status: 400 },
			),
		),
		{ status: "pending" },
	);
});

test("sessionless Codex WebSocket request IDs are UUIDv7", () => {
	const requestId = createCodexRequestId();
	assert.match(requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

function requestBodyText(init: RequestInit): string {
	return init.body instanceof Uint8Array ? zstdDecompressSync(init.body).toString("utf8") : String(init.body);
}

async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function createRegisteredCodexProvider(options?: { codeMode?: boolean | undefined }) {
	const turnState = createCodexTurnState();
	const providers = new Map<string, { streamSimple: (...args: never[]) => AsyncIterable<unknown> }>();
	const handlers = new Map<string, Array<(...args: never[]) => unknown>>();
	const renderers = new Map<string, unknown>();
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const pi = {
		registerProvider(id: string, provider: { streamSimple: (...args: never[]) => AsyncIterable<unknown> }) {
			providers.set(id, provider);
		},
		on(event: string, handler: (...args: never[]) => unknown) {
			handlers.set(event, [...(handlers.get(event) ?? []), handler]);
		},
		registerMessageRenderer(type: string, renderer: unknown) {
			renderers.set(type, renderer);
		},
		sendMessage(message: unknown, messageOptions: unknown) {
			sentMessages.push({ message, options: messageOptions });
		},
	};

	registerOpenAICodexCustomProvider(pi as never, {
		getConfig: () => ({
			openai: DEFAULT_CODEX_CONVERSION_CONFIG.openai,
			beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: options?.codeMode ?? false },
		}),
		turnState,
	});
	return { provider: providers.get("openai-codex")!, handlers, renderers, sentMessages, turnState };
}

test("buildRequestBody keeps Codex request shape stable for common options", () => {
	const body = buildRequestBody(
		codexModel,
		{
			systemPrompt: "Instructions",
			messages: [{ role: "user", content: "Hello" } as never],
			tools: [exampleTool],
		},
		{
			sessionId: "session-" + "x".repeat(80),
			serviceTier: "priority",
			textVerbosity: "medium",
			temperature: 0.2,
			reasoning: "high",
			reasoningSummary: "detailed",
			maxTokens: 1234,
		} as never,
	);

	assert.equal(body.model, "gpt-5.4");
	assert.equal(body.store, false);
	assert.equal(body.stream, true);
	assert.equal(body.instructions, "Instructions");
	assert.deepEqual(body.text, { verbosity: "medium" });
	assert.equal(body.prompt_cache_key, "session-" + "x".repeat(56));
	assert.deepEqual(body.client_metadata, {
		session_id: "session-" + "x".repeat(80),
		thread_id: "session-" + "x".repeat(80),
	});
	assert.equal(body.tool_choice, "auto");
	assert.equal(body.parallel_tool_calls, true);
	assert.equal(body.service_tier, "priority");
	assert.equal(body.temperature, 0.2);
	assert.deepEqual(body.reasoning, { effort: "high", summary: "detailed" });
	assert.deepEqual(body.include, ["reasoning.encrypted_content"]);
	assert.deepEqual(body.tools, [
		{
			type: "function",
			name: "example_tool",
			description: "Example tool",
			parameters: {
				type: "object",
				properties: { value: { type: "string" } },
				required: ["value"],
			},
			strict: null,
		},
	]);
	assert.equal("max_output_tokens" in body, false, "Codex ChatGPT backend rejects max_output_tokens");
	assert.equal("max_completion_tokens" in body, false, "Codex ChatGPT backend rejects max token aliases here");
});

test("buildRequestBody anchors newly activated tools at their loader result", () => {
	const nativeBody = buildRequestBody(
		{ ...(codexModel as object), compat: { supportsToolSearch: true } } as never,
		{ messages: toolLoadingMessages, tools: [searchToolsTool, exampleTool] },
	);

	assert.deepEqual((nativeBody.tools as Array<{ name: string }>).map((tool) => tool.name), ["search_tools"]);
	const searchCall = nativeBody.input.find((item) => (item as { type?: string }).type === "tool_search_call") as {
		call_id: string;
		arguments: { query: string; limit: number };
	};
	const searchOutput = nativeBody.input.find((item) => (item as { type?: string }).type === "tool_search_output") as {
		call_id: string;
		tools: Array<Record<string, unknown>>;
	};
	assert.match(searchCall.call_id, /^pi_tool_load_/);
	assert.deepEqual(searchCall.arguments, { query: "example_tool", limit: 1 });
	assert.equal(searchOutput.call_id, searchCall.call_id);
	assert.deepEqual(searchOutput.tools, [{
		type: "function",
		name: "example_tool",
		description: "Example tool",
		parameters: {
			type: "object",
			properties: { value: { type: "string" } },
			required: ["value"],
		},
		strict: false,
		defer_loading: true,
	}]);

	const fallbackBody = buildRequestBody(codexModel, { messages: toolLoadingMessages, tools: [searchToolsTool, exampleTool] });
	assert.deepEqual((fallbackBody.tools as Array<{ name: string }>).map((tool) => tool.name), ["search_tools", "example_tool"]);
	assert.equal(fallbackBody.input.some((item) => (item as { type?: string }).type === "tool_search_call"), false);
});

test("GPT-5.6 Code Mode sends the GPT-5.6 input-item contract", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider({ codeMode: true });
	let captured: RequestInit | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			captured = init;
			return sseResponse([
				{ type: "response.created", response: { id: "resp_lite" } },
				{ type: "response.completed", response: { id: "resp_lite", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
			]);
		}) as typeof fetch;

		await collectStream(registered.provider.streamSimple(
			{ ...(codexModel as object), id: "gpt-5.6-luna", baseUrl: "https://chatgpt.example/backend-api", compat: { supportsToolSearch: true } } as never,
			{ systemPrompt: "Lite instructions", messages: toolLoadingMessages, tools: [...codeModeTools, searchToolsTool, exampleTool] } as never,
			{ apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }), transport: "sse", reasoning: "medium", toolChoice: "required" } as never,
		));

		assert.ok(captured);
		assert.equal((captured.headers as Headers).get("x-openai-internal-codex-responses-lite"), "true");
		const body = JSON.parse(requestBodyText(captured));
		assert.equal("instructions" in body, false);
		assert.equal("tools" in body, false);
		assert.equal(body.parallel_tool_calls, false);
		assert.equal(body.tool_choice, "required");
		assert.equal(body.reasoning.context, "all_turns");
		assert.equal(body.input[0].type, "additional_tools");
		assert.deepEqual(body.input[0].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["custom", "exec"], ["function", "wait"], ["function", "search_tools"]]);
		assert.equal("parameters" in body.input[0].tools[0], false);
		assert.deepEqual(body.input[1], { type: "message", role: "developer", content: [{ type: "input_text", text: "Lite instructions" }] });
		assert.deepEqual(body.input.find((item: { type?: string }) => item.type === "tool_search_output").tools.map((tool: { name: string; defer_loading?: boolean }) => [tool.name, tool.defer_loading]), [["example_tool", true]]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("registered Codex provider retries retryable SSE failures and streams the final response", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider();
	const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
	const responseEvents = [
		{ type: "response.created", response: { id: "resp_1" } },
		{ type: "response.output_item.added", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [] } },
		{ type: "response.content_part.added", output_index: 0, content_index: 0, part: { type: "output_text", text: "" } },
		{ type: "response.output_text.delta", output_index: 0, content_index: 0, delta: "Hello" },
		{ type: "response.output_item.done", output_index: 0, item: { type: "message", id: "msg_1", role: "assistant", content: [{ type: "output_text", text: "Hello" }], status: "completed" } },
		{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 12, output_tokens: 3, total_tokens: 15, input_tokens_details: { cached_tokens: 5 } } } },
	];

	try {
		globalThis.fetch = (async (url, init) => {
			fetchCalls.push({ url: String(url), init: init as RequestInit });
			return fetchCalls.length === 1
				? new Response("temporary overloaded", { status: 500, statusText: "Server Error" })
				: sseResponse(responseEvents);
		}) as typeof fetch;

		const onResponses: unknown[] = [];
		const stream = registered.provider.streamSimple(
			{ ...(codexModel as object), baseUrl: "https://chatgpt.example/backend-api", cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } } as never,
			{ systemPrompt: "Instructions", messages: [] } as never,
			{
				apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }),
				transport: "sse",
				sessionId: "session-1",
				onResponse: (response: unknown) => onResponses.push(response),
			} as never,
		);

		const events = await collectStream(stream);
		const done = events.at(-1) as { type: string; message: { responseId?: string; content: Array<{ type: string; text?: string }>; usage: { input: number; cacheRead: number; output: number; totalTokens: number } } };

		assert.equal(fetchCalls.length, 2);
		assert.equal(fetchCalls[0]!.url, "https://chatgpt.example/backend-api/codex/responses");
		assert.equal((fetchCalls[1]!.init.headers as Headers).get("session-id"), "session-1");
		assert.equal((fetchCalls[1]!.init.headers as Headers).get("thread-id"), "session-1");
		assert.equal((fetchCalls[1]!.init.headers as Headers).get("chatgpt-account-id"), "acct_1");
		assert.equal((fetchCalls[1]!.init.headers as Headers).get("content-encoding"), "zstd");
		assert.equal(JSON.parse(requestBodyText(fetchCalls[1]!.init)).instructions, "Instructions");
		assert.deepEqual(onResponses.map((response) => (response as { status: number }).status), [500, 200]);
		assert.equal(events.some((event) => (event as { type?: string }).type === "start"), true);
		assert.equal(events.some((event) => (event as { type?: string; delta?: string }).type === "text_delta" && (event as { delta?: string }).delta === "Hello"), true);
		assert.equal(done.type, "done");
		assert.equal(done.message.responseId, "resp_1");
		assert.deepEqual(done.message.content, [{ type: "text", text: "Hello", textSignature: JSON.stringify({ v: 1, id: "msg_1" }) }]);
		assert.deepEqual(done.message.usage, { input: 7, output: 3, cacheRead: 5, cacheWrite: 0, reasoning: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("Codex turn state is captured and replayed on SSE follow-ups", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider();
	const capturedHeaders: Headers[] = [];
	try {
		globalThis.fetch = (async (_url, init) => {
			capturedHeaders.push(new Headers(init?.headers));
			return new Response('data: {"type":"response.completed","response":{"id":"resp_1","status":"completed","usage":{"input_tokens":0,"output_tokens":0,"total_tokens":0}}}\n\n', {
				status: 200,
				headers: capturedHeaders.length === 1
					? { "content-type": "text/event-stream", "x-codex-turn-state": "ts-1" }
					: { "content-type": "text/event-stream" },
			});
		}) as typeof fetch;

		const options = { apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }), transport: "sse" } as never;
		const model = { ...(codexModel as object), baseUrl: "https://chatgpt.example/backend-api" } as never;
		await collectStream(registered.provider.streamSimple(model, { systemPrompt: "Instructions", messages: [] } as never, options));
		await collectStream(registered.provider.streamSimple(model, { systemPrompt: "Instructions", messages: [] } as never, options));

		assert.equal(capturedHeaders[0]!.get("x-codex-turn-state"), null);
		assert.equal(capturedHeaders[1]!.get("x-codex-turn-state"), "ts-1");
		assert.equal(registered.turnState.current(), "ts-1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("cached websocket request body reuses continuation across reasoning changes", () => {
	const previousBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1", reasoning: "low" });
	previousBody.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "first" }] }];
	const responseItems = [{ type: "message", role: "assistant", content: [{ type: "output_text", text: "first response" }] }];
	const fullBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1", reasoning: "high" });
	const nextInput = { type: "message", role: "user", content: [{ type: "input_text", text: "next" }] };
	fullBody.input = [...previousBody.input, ...responseItems, nextInput];

	assert.deepEqual(
		buildCachedWebSocketRequestBody({ lastRequestBody: previousBody, lastResponseId: "resp_1", lastResponseItems: responseItems }, fullBody),
		{
			body: { ...fullBody, previous_response_id: "resp_1", input: [nextInput] },
			decision: "delta",
		},
	);
});

test("cached websocket continuation falls back when the tool set changes", () => {
	const previousBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [], tools: [exampleTool] }, { sessionId: "session-1" });
	const currentBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [], tools: [] }, { sessionId: "session-1" });
	assert.equal(buildCachedWebSocketRequestBody({
		lastRequestBody: previousBody,
		lastResponseId: "resp_1",
		lastResponseItems: [],
	}, currentBody).decision, "body_mismatch");
});

test("cached websocket continuation keeps native dynamic tool loading in the input delta", () => {
	const model = { ...(codexModel as object), compat: { supportsToolSearch: true } } as never;
	const previousBody = buildRequestBody(
		model,
		{ messages: [toolLoadingMessages[0]], tools: [searchToolsTool] } as never,
		{ sessionId: "session-1" },
	);
	const fullBody = buildRequestBody(
		model,
		{ messages: toolLoadingMessages, tools: [searchToolsTool, exampleTool] },
		{ sessionId: "session-1" },
	);
	const responseItems = [fullBody.input[previousBody.input.length]];
	const result = buildCachedWebSocketRequestBody({
		lastRequestBody: previousBody,
		lastResponseId: "resp_search",
		lastResponseItems: responseItems,
	}, fullBody);

	assert.equal(result.decision, "delta");
	assert.equal(result.body.previous_response_id, "resp_search");
	assert.deepEqual((result.body.tools as Array<{ name: string }>).map((tool) => tool.name), ["search_tools"]);
	assert.deepEqual(result.body.input.map((item) => (item as { type?: string }).type), ["function_call_output", "tool_search_call", "tool_search_output"]);
});

test("parseSSE accepts CRLF chunks, joined data lines, and ignores done sentinel", async () => {
	const response = new Response([
		'data: {"type":"response.created",\r\n',
		'data: "response":{"id":"resp_1"}}\r\n\r\n',
		"data: [DONE]\r\n\r\n",
	].join(""));

	const events = [];
	for await (const event of parseSSE(response)) events.push(event);

	assert.deepEqual(events, [{ type: "response.created", response: { id: "resp_1" } }]);
});
