import test from "node:test";
import assert from "node:assert/strict";
import {
	buildProviderErrorMessage,
	buildRequestBody,
	buildCachedWebSocketRequestBody,
	getEffectiveCodexTransport,
	requestBodyForWebSocketContinuationComparison,
	parseSSE,
	registerOpenAICodexCustomProvider,
} from "../src/providers/openai-codex-custom-provider.ts";

const exampleTool = {
	name: "example_tool",
	description: "Example tool",
	parameters: {
		type: "object",
		properties: { value: { type: "string" } },
		required: ["value"],
	},
} as never;

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

function fakeJwt(payload: Record<string, unknown>): string {
	return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}

function sseResponse(events: unknown[]): Response {
	return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), {
		status: 200,
		headers: { "content-type": "text/event-stream" },
	});
}

async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function createRegisteredCodexProvider(options?: { cwd?: string | undefined }) {
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

	registerOpenAICodexCustomProvider(pi as never, { getCurrentCwd: () => options?.cwd ?? process.cwd() });
	return { provider: providers.get("openai-codex")!, handlers, renderers, sentMessages };
}

test("buildRequestBody sends a non-empty fallback system prompt", () => {
	const body = buildRequestBody(codexModel, { systemPrompt: "", messages: [] });
	assert.equal(body.instructions, "You are a helpful assistant.");
});

test("buildRequestBody preserves provided system prompts", () => {
	const body = buildRequestBody(codexModel, { systemPrompt: "Custom instructions", messages: [] });
	assert.equal(body.instructions, "Custom instructions");
});

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

test("buildRequestBody omits reasoning when Pi thinking is off", () => {
	const body = buildRequestBody(
		codexModel,
		{ systemPrompt: "Instructions", messages: [] },
		{ reasoning: "off" } as never,
	);

	assert.equal(body.reasoning, undefined);
});

test("registered Codex provider exposes provider and shutdown handler", () => {
	const registered = createRegisteredCodexProvider();

	assert.equal(typeof registered.provider.streamSimple, "function");
	assert.equal(registered.renderers.size, 0);
	assert.equal((registered.handlers.get("session_shutdown") ?? []).length, 1);
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
		assert.equal((fetchCalls[1]!.init.headers as Headers).get("chatgpt-account-id"), "acct_1");
		assert.equal(JSON.parse(fetchCalls[1]!.init.body as string).instructions, "Instructions");
		assert.deepEqual(onResponses.map((response) => (response as { status: number }).status), [500, 200]);
		assert.equal(events.some((event) => (event as { type?: string }).type === "start"), true);
		assert.equal(events.some((event) => (event as { type?: string; delta?: string }).type === "text_delta" && (event as { delta?: string }).delta === "Hello"), true);
		assert.equal(done.type, "done");
		assert.equal(done.message.responseId, "resp_1");
		assert.deepEqual(done.message.content, [{ type: "text", text: "Hello", textSignature: JSON.stringify({ v: 1, id: "msg_1" }) }]);
		assert.deepEqual(done.message.usage, { input: 7, output: 3, cacheRead: 5, cacheWrite: 0, totalTokens: 15, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("registered Codex provider converts non-retryable SSE errors into error events", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider();

	try {
		globalThis.fetch = (async () => new Response(JSON.stringify({ error: { message: "Bad request shape" } }), { status: 400, statusText: "Bad Request" })) as typeof fetch;
		const events = await collectStream(registered.provider.streamSimple(
			codexModel,
			{ systemPrompt: "Instructions", messages: [] } as never,
			{ apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }), transport: "sse" } as never,
		));

		assert.equal(events.length, 1);
		assert.equal((events[0] as { type?: string }).type, "error");
		assert.equal((events[0] as { error?: { errorMessage?: string } }).error?.errorMessage, "Bad request shape");
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("buildProviderErrorMessage marks websocket failures as Pi retryable connection errors", () => {
	assert.equal(buildProviderErrorMessage(new Error("WebSocket error")), "Connection error: WebSocket error");
	assert.equal(buildProviderErrorMessage(new Error("WebSocket closed 1000")), "Connection error: WebSocket closed 1000");
	assert.equal(
		buildProviderErrorMessage(new Error("WebSocket stream closed before response.completed")),
		"Connection error: WebSocket stream closed before response.completed",
	);
	assert.equal(buildProviderErrorMessage(new Error("Unsupported parameter: max_output_tokens")), "Unsupported parameter: max_output_tokens");
});

test("buildProviderErrorMessage formats Codex usage limit JSON", () => {
	const error = new Error(`Turn prefix summarization failed: Codex error: ${JSON.stringify({
		type: "error",
		error: { type: "usage_limit_reached", message: "The usage limit has been reached", plan_type: "prolite", resets_in_seconds: 1860 },
		status_code: 429,
		headers: {
			"X-Codex-Active-Limit": "premium",
			"X-Codex-Primary-Used-Percent": "100",
			"X-Codex-Secondary-Used-Percent": "51",
			"X-Codex-Bengalfox-Primary-Used-Percent": "0",
			"X-Codex-Bengalfox-Secondary-Used-Percent": "4",
			"X-Codex-Bengalfox-Limit-Name": "GPT-5.3-Codex-Spark",
		},
	})}`);

	assert.equal(
		buildProviderErrorMessage(error),
		"Codex usage limit reached (prolite plan). Resets in ~31m. Current premium: 5h 100%, weekly 51%. Extra GPT-5.3-Codex-Spark: 5h 0%, weekly 4%.",
	);
});

test("websocket continuation comparison ignores per-turn reasoning changes", () => {
	const base = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1", reasoning: "low" });
	const changedReasoning = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1", reasoning: "high" });

	assert.deepEqual(
		requestBodyForWebSocketContinuationComparison(changedReasoning),
		requestBodyForWebSocketContinuationComparison(base),
		"changing thinking level should not force a full-context WebSocket request",
	);
});

test("websocket continuation comparison still includes semantic request fields", () => {
	const base = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1", reasoning: "low" });
	const changedModel = { ...base, model: "different-model" };

	assert.notDeepEqual(
		requestBodyForWebSocketContinuationComparison(changedModel),
		requestBodyForWebSocketContinuationComparison(base),
		"model changes must still force a full-context WebSocket request",
	);
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

test("cached websocket request body sends parallel tool outputs when assistant item replay drifts", () => {
	const previousBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1" });
	previousBody.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "inspect" }] }];
	const responseItems = [
		{ type: "function_call", id: "fc_1", call_id: "call_1", name: "exec_command", arguments: "{}" },
		{ type: "function_call", id: "fc_2", call_id: "call_2", name: "semantic_grep", arguments: "{}" },
	];
	const toolOutputs = [
		{ type: "function_call_output", call_id: "call_1", output: "one" },
		{ type: "function_call_output", call_id: "call_2", output: "two" },
	];
	const fullBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1" });
	fullBody.input = [
		...previousBody.input,
		{ ...responseItems[0], id: "fc_replayed_1" },
		{ ...responseItems[1], id: "fc_replayed_2" },
		...toolOutputs,
	];

	assert.deepEqual(
		buildCachedWebSocketRequestBody({ lastRequestBody: previousBody, lastResponseId: "resp_1", lastResponseItems: responseItems }, fullBody),
		{
			body: { ...fullBody, previous_response_id: "resp_1", input: toolOutputs },
			decision: "delta",
		},
	);
});

test("cached websocket request body keeps follow-up input after drifted tool outputs", () => {
	const previousBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1" });
	previousBody.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "inspect" }] }];
	const responseItems = [
		{ type: "function_call", id: "fc_1", call_id: "call_1", name: "exec_command", arguments: "{}" },
		{ type: "function_call", id: "fc_2", call_id: "call_2", name: "semantic_grep", arguments: "{}" },
	];
	const delta = [
		{ type: "function_call_output", call_id: "call_1", output: "one" },
		{ type: "function_call_output", call_id: "call_2", output: "two" },
		{ type: "message", role: "user", content: [{ type: "input_text", text: "now answer this" }] },
	];
	const fullBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1" });
	fullBody.input = [
		...previousBody.input,
		{ ...responseItems[0], id: "fc_replayed_1" },
		{ ...responseItems[1], id: "fc_replayed_2" },
		...delta,
	];

	assert.deepEqual(
		buildCachedWebSocketRequestBody({ lastRequestBody: previousBody, lastResponseId: "resp_1", lastResponseItems: responseItems }, fullBody),
		{
			body: { ...fullBody, previous_response_id: "resp_1", input: delta },
			decision: "delta",
		},
	);
});

test("cached websocket request body reports explicit non-delta decisions", () => {
	const previousBody = buildRequestBody(codexModel, { systemPrompt: "Instructions", messages: [] }, { sessionId: "session-1" });
	previousBody.input = [{ type: "message", role: "user", content: [{ type: "input_text", text: "first" }] }];
	const continuation = { lastRequestBody: previousBody, lastResponseId: "resp_1", lastResponseItems: [] };

	assert.deepEqual(buildCachedWebSocketRequestBody(undefined, previousBody), { body: previousBody, decision: "no_continuation" });

	const changedModel = { ...previousBody, model: "other-model" };
	assert.deepEqual(buildCachedWebSocketRequestBody(continuation, changedModel), { body: changedModel, decision: "body_mismatch" });

	const shorter = { ...previousBody, input: [] };
	assert.deepEqual(buildCachedWebSocketRequestBody(continuation, shorter), { body: shorter, decision: "input_shorter_than_baseline" });

	const missingPreviousResponse = { ...previousBody, input: [...previousBody.input, { type: "message", role: "user", content: [] }] };
	assert.deepEqual(
		buildCachedWebSocketRequestBody({ ...continuation, lastResponseId: "" }, missingPreviousResponse),
		{ body: missingPreviousResponse, decision: "missing_previous_response_id" },
	);
});

test("getEffectiveCodexTransport enables cached websockets without overriding auto or sse fallback semantics", () => {
	assert.equal(getEffectiveCodexTransport(undefined, undefined), "auto");
	assert.equal(getEffectiveCodexTransport(undefined, { forceCachedWebSockets: true }), "auto");
	assert.equal(getEffectiveCodexTransport("auto", { forceCachedWebSockets: true }), "auto");
	assert.equal(getEffectiveCodexTransport("websocket", { forceCachedWebSockets: true }), "websocket-cached");
	assert.equal(getEffectiveCodexTransport("websocket-cached", { forceCachedWebSockets: true }), "websocket-cached");
	assert.equal(getEffectiveCodexTransport("sse", { forceCachedWebSockets: true }), "sse");
});

test("getEffectiveCodexTransport preserves Pi transport when cached websocket override is disabled", () => {
	assert.equal(getEffectiveCodexTransport(undefined, { forceCachedWebSockets: false }), "auto");
	assert.equal(getEffectiveCodexTransport("websocket", { forceCachedWebSockets: false }), "websocket");
	assert.equal(getEffectiveCodexTransport("websocket-cached", { forceCachedWebSockets: false }), "websocket-cached");
});

test("parseSSE fails loudly on malformed Codex JSON", async () => {
	const response = new Response("data: {not json}\n\n");
	await assert.rejects(async () => {
		for await (const _event of parseSSE(response)) {
			// consume stream
		}
	}, /Invalid Codex SSE JSON/);
});

test("parseSSE aborts response body reads when the caller aborts", async () => {
	const controller = new AbortController();
	let canceled = false;
	const stream = new ReadableStream({
		start(innerController) {
			innerController.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"resp_1"}}\n\n'));
		},
		cancel() {
			canceled = true;
		},
	});

	const events = parseSSE(new Response(stream), controller.signal);
	const iterator = events[Symbol.asyncIterator]();
	assert.equal((await iterator.next()).value.type, "response.created");

	controller.abort();
	await assert.rejects(() => iterator.next(), /Request was aborted/);
	assert.equal(canceled, true);
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

