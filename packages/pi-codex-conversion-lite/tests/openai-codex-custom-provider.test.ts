import test from "node:test";
import assert from "node:assert/strict";
import { zstdDecompressSync } from "node:zlib";
import {
	buildRequestBody,
	parseSSE,
	registerOpenAICodexCustomProvider,
} from "../src/providers/openai-codex-custom-provider.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { parseOpenAICodexDeviceAuthPollResponse } from "../src/providers/openai-codex/oauth.ts";
import { CODE_MODE_EXEC_GRAMMAR } from "../src/tools/code-mode/exec-contract.ts";

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
	{
		name: "exec",
		description: "Compose tools",
		parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
		constrainedSampling: { type: "grammar", variants: { openai_lark: CODE_MODE_EXEC_GRAMMAR } },
	},
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
function requestBodyText(init: RequestInit): string {
	return init.body instanceof Uint8Array ? zstdDecompressSync(init.body).toString("utf8") : String(init.body);
}

async function collectStream(stream: AsyncIterable<unknown>): Promise<unknown[]> {
	const events: unknown[] = [];
	for await (const event of stream) events.push(event);
	return events;
}

function createRegisteredCodexProvider(options?: { codeMode?: boolean | undefined; harnessIdentifierHeader?: boolean | undefined }) {
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
			openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, harnessIdentifierHeader: options?.harnessIdentifierHeader ?? false },
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

	const normalModeBody = buildRequestBody(codexModel, {
		messages: [],
		tools: codeModeTools,
	});
	assert.deepEqual(
		(normalModeBody.tools as Array<{ type: string; name: string }>).map(({ type, name }) => [type, name]),
		[["function", "exec"], ["function", "wait"]],
	);
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

test("pi-codex-conversion originator is opt-in", async () => {
	const originalFetch = globalThis.fetch;
	const capturedOriginators: Array<string | null> = [];
	try {
		globalThis.fetch = (async (_url, init) => {
			capturedOriginators.push(new Headers(init?.headers).get("originator"));
			return sseResponse([{ type: "response.completed", response: { id: "resp_1", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]);
		}) as typeof fetch;
		const requestOptions = { apiKey: fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_1" } }), transport: "sse" } as never;
		const model = { ...(codexModel as object), baseUrl: "https://chatgpt.example/backend-api" } as never;
		for (const harnessIdentifierHeader of [false, true]) {
			const registered = createRegisteredCodexProvider({ harnessIdentifierHeader });
			await collectStream(registered.provider.streamSimple(model, { systemPrompt: "Instructions", messages: [] } as never, requestOptions));
		}

		assert.deepEqual(capturedOriginators, ["pi", "pi-codex-conversion"]);
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

test("parseSSE accepts CRLF chunks, joined data lines, and ignores done sentinel", async () => {
	const encoder = new TextEncoder();
	const response = new Response(new ReadableStream({
		start(controller) {
			for (const chunk of [
				'data: {"type":"response.created",\r',
				'\ndata: "response":{"id":"resp_1"}}\r',
				"\n\r",
				"\ndata: [DONE]\r\n\r\n",
			]) controller.enqueue(encoder.encode(chunk));
			controller.close();
		},
	}));

	const events = [];
	for await (const event of parseSSE(response)) events.push(event);

	assert.deepEqual(events, [{ type: "response.created", response: { id: "resp_1" } }]);
});
