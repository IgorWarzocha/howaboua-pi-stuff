import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import {
	buildSSEHeaders,
	buildWebSocketHeaders,
	CODEX_FAST_MODE_ORIGINATOR,
	PI_CODEX_CONVERSION_ORIGINATOR,
	resolveCodexRequestRouting,
	X_CODEX_ROUTING_HINT_HEADER,
} from "../src/providers/openai-codex/headers.ts";
import {
	codeModeTools,
	codexModel,
	collectStream,
	createRegisteredCodexProvider,
	exampleTool,
	fakeJwt,
	requestBodyText,
	searchToolsTool,
	sseResponse,
	toolLoadingMessages,
} from "./openai-codex-test-support.ts";

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

test("final provider hook captures configured Responses instructions for native replay", async () => {
	const state: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "normal",
		codexTurnState: createCodexTurnState(),
		pendingActiveProviderPromptCapture: true,
		activeProviderSystemPrompt: "stale prompt",
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			scope: { allProviders: "off", additionalProviders: ["passthrough"] },
		},
	};
	const ctx = {
		cwd: "/repo",
		model: {
			provider: "passthrough",
			api: "openai-responses",
			id: "gpt-5.6",
			baseUrl: "https://proxy.example/v1",
		},
	} as never;
	const finalPayload = await rewriteCodexProviderRequest({
		model: "gpt-5.6",
		instructions: "final chained instructions",
		input: [],
		text: { verbosity: "low" },
		parallel_tool_calls: true,
	}, ctx, state) as { instructions?: string };

	assert.equal(finalPayload.instructions, "final chained instructions");
	assert.equal(state.activeProviderSystemPrompt, "final chained instructions");
});

test("strict tool constraints serialize closed schemas and honor fallback policy", () => {
	const parameters = {
		type: "object",
		properties: {
			path: { type: "string" },
			offset: { type: "number" },
			metadata: {
				type: "object",
				properties: { enabled: { type: "boolean" } },
			},
		},
		required: ["path", "metadata"],
	};
	const strictTool = {
		name: "strict_tool",
		description: "Strict tool",
		parameters,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
	};
	const body = buildRequestBody(codexModel, { messages: [], tools: [strictTool] } as never);
	assert.deepEqual(body.tools, [{
		type: "function",
		name: "strict_tool",
		description: "Strict tool",
		parameters: {
			type: "object",
			properties: {
				path: { type: "string" },
				offset: { anyOf: [{ type: "number" }, { type: "null" }] },
				metadata: {
					type: "object",
					properties: { enabled: { anyOf: [{ type: "boolean" }, { type: "null" }] } },
					required: ["enabled"],
					additionalProperties: false,
				},
			},
			required: ["path", "offset", "metadata"],
			additionalProperties: false,
		},
		strict: true,
	}]);
	assert.deepEqual(parameters.required, ["path", "metadata"], "request conversion must not mutate Pi's tool schema");
	assert.equal("additionalProperties" in parameters, false);

	const unsupportedParameters = {
		type: "object",
		properties: {},
		additionalProperties: { type: "string" },
	};
	const fallback = buildRequestBody(codexModel, {
		messages: [],
		tools: [{ ...strictTool, parameters: unsupportedParameters }],
	} as never).tools as Array<{ strict: boolean | null; parameters: unknown }>;
	assert.equal(fallback[0]?.strict, null);
	assert.equal(fallback[0]?.parameters, unsupportedParameters);

	assert.throws(() => buildRequestBody(codexModel, {
		messages: [],
		tools: [{
			...strictTool,
			parameters: unsupportedParameters,
			constrainedSampling: { type: "json_schema", strict: "require" },
		}],
	} as never), /requires JSON-schema constrained sampling.*additionalProperties is unsupported/);

	const unsupportedProviderBody = buildRequestBody({
		...(codexModel as object),
		compat: { supportsStrictMode: false },
	} as never, { messages: [], tools: [strictTool] } as never);
	assert.equal("strict" in (unsupportedProviderBody.tools as object[])[0]!, false);
});

test("Fast Mode request identity is opt-in and transport invariant", () => {
	const model = "gpt-5.6-luna";
	const fastRouting = resolveCodexRequestRouting({
		model,
		fast: true,
		serviceTier: "priority",
		normalOriginator: PI_CODEX_CONVERSION_ORIGINATOR,
	});
	assert.deepEqual(fastRouting, {
		originator: CODEX_FAST_MODE_ORIGINATOR,
		routingHint: `model=${model};tier=priority`,
	});

	const transportHeaders = [
		buildSSEHeaders(undefined, undefined, "account", "token", "session", false, fastRouting.originator, fastRouting.routingHint),
		buildWebSocketHeaders(undefined, undefined, "account", "token", "session", fastRouting.originator, fastRouting.routingHint),
	];
	for (const headers of transportHeaders) {
		assert.equal(headers.get("originator"), CODEX_FAST_MODE_ORIGINATOR);
		assert.equal(headers.get(X_CODEX_ROUTING_HINT_HEADER), `model=${model};tier=priority`);
	}

	const normalRouting = resolveCodexRequestRouting({
		model,
		fast: false,
		serviceTier: "priority",
		normalOriginator: PI_CODEX_CONVERSION_ORIGINATOR,
	});
	assert.deepEqual(normalRouting, { originator: PI_CODEX_CONVERSION_ORIGINATOR });
	const normalHeaders = buildSSEHeaders(undefined, undefined, "account", "token", "session", false, normalRouting.originator, normalRouting.routingHint);
	assert.equal(normalHeaders.get("originator"), PI_CODEX_CONVERSION_ORIGINATOR);
	assert.equal(normalHeaders.get(X_CODEX_ROUTING_HINT_HEADER), null);
	const inheritedHeaders = buildSSEHeaders(
		{ [X_CODEX_ROUTING_HINT_HEADER]: `model=${model};tier=priority` },
		undefined,
		"account",
		"token",
		"session",
		false,
		normalRouting.originator,
		normalRouting.routingHint,
	);
	assert.equal(inheritedHeaders.get(X_CODEX_ROUTING_HINT_HEADER), null);
	assert.deepEqual(resolveCodexRequestRouting({
		model,
		fast: true,
		normalOriginator: PI_CODEX_CONVERSION_ORIGINATOR,
	}), { originator: PI_CODEX_CONVERSION_ORIGINATOR });
});

test("GPT-5.6 Code Mode sends the GPT-5.6 input-item contract", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider({ codeMode: true });
	const deferredExec = { ...(codeModeTools[0] as object), name: "deferred_exec" } as never;
	const messages = [
		toolLoadingMessages[0],
		toolLoadingMessages[1],
		{ ...(toolLoadingMessages[2] as object), addedToolNames: ["example_tool", "deferred_exec"] },
	] as never;
	let captured: RequestInit | undefined;
	try {
		globalThis.fetch = (async (_url, init) => {
			captured = init;
			return sseResponse([
				{ type: "response.created", response: { id: "resp_lite" } },
				{ type: "response.completed", response: { id: "resp_lite", status: "completed", end_turn: true, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
			]);
		}) as typeof fetch;

		const events = await collectStream(registered.provider.streamSimple(
			{ ...(codexModel as object), id: "gpt-5.6-luna", baseUrl: "https://chatgpt.example/backend-api", compat: { supportsAdditionalTools: true, supportsToolSearch: true } } as never,
			{ systemPrompt: "Lite instructions", messages, tools: [...codeModeTools, searchToolsTool, exampleTool, deferredExec] } as never,
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
		assert.deepEqual(body.input[0].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(body.input[0].tools[0].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["custom", "exec"], ["function", "wait"], ["function", "search_tools"]]);
		assert.equal("parameters" in body.input[0].tools[0].tools[0], false);
		assert.deepEqual(body.input[1], { type: "message", role: "developer", content: [{ type: "input_text", text: "Lite instructions" }] });
		const additionalTools = body.input.filter((item: { type?: string }) => item.type === "additional_tools");
		assert.equal(additionalTools.length, 2);
		assert.deepEqual(additionalTools[1].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(additionalTools[1].tools[0].tools.map((tool: { type: string; name: string; defer_loading?: boolean }) => [tool.type, tool.name, tool.defer_loading]), [
			["function", "example_tool", undefined],
			["custom", "deferred_exec", undefined],
		]);
		assert.equal(body.input.some((item: { type?: string }) => item.type === "tool_search_output"), false);
		const done = events.find((event) => (event as { type?: string }).type === "done") as { message: { endTurn?: boolean } };
		assert.equal(done.message.endTurn, true);
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
