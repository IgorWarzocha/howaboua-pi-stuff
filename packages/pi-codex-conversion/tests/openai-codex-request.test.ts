import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryCredentialStore, InMemoryModelsStore, normalizeContext } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { buildRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import { applyResponsesLiteRequest } from "../src/providers/openai-codex/responses-lite.ts";
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

async function assertCodexCatalogComposition() {
	const { registration } = createRegisteredCodexProvider();
	const dir = await mkdtemp(join(tmpdir(), "codex-catalog-"));
	try {
		const modelsPath = join(dir, "models.json");
		const config = { providers: { "openai-codex": {
			baseUrl: "https://proxy.example.test/backend-api",
			models: [{ id: "custom-codex", name: "User Codex", contextWindow: 123456 }],
			modelOverrides: { "gpt-6-astra": { contextWindow: 234567 } },
		} } };
		await writeFile(modelsPath, JSON.stringify(config));
		const credentials = new InMemoryCredentialStore();
		await credentials.modify("openai-codex", async () => ({ type: "oauth", access: "test-access", refresh: "test-refresh", expires: Date.now() + 3600000 }));
		const runtime = await ModelRuntime.create({ modelsPath, credentials, modelsStore: new InMemoryModelsStore(), refreshOnCreate: false });
		runtime.registerNativeProvider(registration);
		await runtime.refresh({ allowNetwork: false });
		const available = await runtime.getAvailable("openai-codex");
		const custom = available.find(({ id }) => id === "custom-codex")!;
		assert.equal(custom.name, "User Codex");
		assert.equal(custom.contextWindow, 123456);
		assert.equal(custom.api, "openai-codex-responses");
		assert.equal(custom.baseUrl, config.providers["openai-codex"].baseUrl);
		assert.equal(available.find(({ id }) => id === "gpt-6-astra")?.contextWindow, 234567);
		assert.ok(available.some(({ id }) => id === "gpt-daybreak-red-latest"));
		assert.deepEqual(await runtime.getAuth(custom), { auth: { apiKey: "test-access", headers: undefined }, source: "OAuth" });
		config.providers["openai-codex"].models = [{ id: "replacement-codex", name: "Reloaded", contextWindow: 345678 }];
		await writeFile(modelsPath, JSON.stringify(config));
		await runtime.refresh({ allowNetwork: false });
		const reloaded = await runtime.getAvailable("openai-codex");
		assert.equal(reloaded.some(({ id }) => id === "custom-codex"), false);
		assert.equal(reloaded.find(({ id }) => id === "replacement-codex")?.contextWindow, 345678);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

function assertCodexRequestShape() {
	const body = buildRequestBody(
		codexModel,
		normalizeContext({
			systemPrompt: "Instructions",
			messages: [{ role: "user", content: "Hello" } as never],
			tools: [exampleTool],
		}),
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
			strict: false,
		},
	]);
	assert.equal("max_output_tokens" in body, false, "Codex ChatGPT backend rejects max_output_tokens");
	assert.equal("max_completion_tokens" in body, false, "Codex ChatGPT backend rejects max token aliases here");

	const normalModeBody = buildRequestBody(codexModel, normalizeContext({
		messages: [],
		tools: codeModeTools,
	}));
	assert.deepEqual(
		(normalModeBody.tools as Array<{ type: string; name: string }>).map(({ type, name }) => [type, name]),
		[["function", "exec"], ["function", "wait"]],
	);
}

function assertTranscriptSerialization() {
	const transcriptModel = {
		...(codexModel as object),
		compat: {
			supportsOpenAIGrammarTools: true,
			supportsMidConvoSystemMessages: true,
			supportsAdditionalTools: true,
		},
	} as never;
	const transcript = normalizeContext({
		messages: [
			{ role: "system", content: "Base", sections: { rules: "<rules>old</rules>" }, toolsAdded: [exampleTool], timestamp: 0 },
			{ role: "user", content: "Run it", timestamp: 1 },
			{ role: "system", content: "Use the new runner", sections: { rules: "<rules>new</rules>" }, toolsAdded: [codeModeTools[0]], timestamp: 2 },
			{
				role: "assistant",
				content: [{ type: "toolCall", id: "call_exec|ctc_exec", name: "exec", arguments: { code: "return 1" } }],
				api: "openai-codex-responses",
				provider: "openai-codex",
				model: "gpt-5.4",
				usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
				stopReason: "toolUse",
				timestamp: 3,
			},
			{ role: "toolResult", toolCallId: "call_exec|ctc_exec", toolName: "exec", content: [{ type: "text", text: "1" }], isError: false, timestamp: 4 },
			{ role: "system", content: "", toolsRemoved: [{ name: "exec" }], timestamp: 5 },
		] as never,
	});
	const body = buildRequestBody(transcriptModel, transcript);
	assert.equal(body.instructions, "Base\n\n<rules>old</rules>");
	assert.deepEqual((body.tools as Array<{ name: string }>).map(({ name }) => name), ["example_tool"]);
	assert.equal(body.input.some((item) => (item as { type?: string }).type === "additional_tools"), false);
	assert.deepEqual(
		body.input.filter((item) => "role" in (item as object)).map((item) => (item as { role: string; content: unknown }).role),
		["user", "developer"],
	);
	assert.match(JSON.stringify(body.input), /Updated system prompt section \\"rules\\"/);
	assert.ok(body.input.some((item) => (item as { type?: string }).type === "custom_tool_call"), "historical grammar calls use every declared tool");
	const liteAfterRemoval = applyResponsesLiteRequest(body);
	assert.deepEqual(
		(liteAfterRemoval.input[0] as { tools: Array<{ tools: Array<{ name: string }> }> }).tools[0]?.tools.map(({ name }) => name),
		["example_tool"],
	);
	assert.equal(liteAfterRemoval.input.slice(1).some((item) => (item as { type?: string }).type === "additional_tools"), false);

	const searched = buildRequestBody({
		...(codexModel as object),
		compat: { supportsDeveloperRole: false, supportsMidConvoSystemMessages: true, supportsToolSearch: true },
	} as never, normalizeContext({
		messages: [
			{ role: "system", content: "Base", toolsAdded: [exampleTool], timestamp: 0 },
			{ role: "user", content: "Find it", timestamp: 1 },
			{ role: "system", content: "Search update", toolsAdded: [codeModeTools[1]], timestamp: 2 },
		] as never,
	}));
	assert.deepEqual(searched.input.map((item) => (item as { type?: string; role?: string }).type ?? (item as { role?: string }).role), [
		"user",
		"tool_search_call",
		"tool_search_output",
		"system",
	]);
	assert.equal(JSON.stringify(searched.input).includes('"defer_loading":true'), true);
}

function assertStrictToolConstraints() {
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
	const ordinaryBody = buildRequestBody(codexModel, normalizeContext({ messages: [], tools: [{ ...strictTool, constrainedSampling: undefined }] } as never));
	assert.deepEqual(ordinaryBody.tools, [{ type: "function", name: "strict_tool", description: "Strict tool", parameters, strict: false }]);
	const body = buildRequestBody(codexModel, normalizeContext({ messages: [], tools: [strictTool] } as never));
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
	const fallback = buildRequestBody(codexModel, normalizeContext({
		messages: [],
		tools: [{ ...strictTool, parameters: unsupportedParameters }],
	} as never)).tools as Array<{ strict: boolean | null; parameters: unknown }>;
	assert.equal(fallback[0]?.strict, false);
	assert.equal(fallback[0]?.parameters, unsupportedParameters);

	assert.throws(() => buildRequestBody(codexModel, normalizeContext({
		messages: [],
		tools: [{
			...strictTool,
			parameters: unsupportedParameters,
			constrainedSampling: { type: "json_schema", strict: "require" },
		}],
	} as never)), /requires JSON-schema constrained sampling.*additionalProperties is unsupported/);

	const unsupportedProviderBody = buildRequestBody({
		...(codexModel as object),
		compat: { supportsStrictMode: false },
	} as never, normalizeContext({ messages: [], tools: [strictTool] } as never));
	assert.equal("strict" in (unsupportedProviderBody.tools as object[])[0]!, false);
}

test("Codex catalog composition and request serialization preserve user overrides and strict schemas", async () => {
	await assertCodexCatalogComposition();
	assertCodexRequestShape();
	assertTranscriptSerialization();
	assertStrictToolConstraints();
});

test("GPT-5.6 Code Mode sends the GPT-5.6 input-item contract", async () => {
	const originalFetch = globalThis.fetch;
	const registered = createRegisteredCodexProvider({ codeMode: true });
	const deferredExec = { ...(codeModeTools[0] as object), name: "deferred_exec" } as never;
	const messages = [
		...toolLoadingMessages,
		{
			role: "assistant",
			content: [{ type: "toolCall", id: "call_search_2|fc_search_2", name: "search_tools", arguments: { query: "deferred exec" } }],
			api: "openai-codex-responses",
			provider: "openai-codex",
			model: "gpt-5.4",
			stopReason: "toolUse",
			timestamp: 3,
		},
		{
			role: "toolResult",
			toolCallId: "call_search_2|fc_search_2",
			toolName: "search_tools",
			content: [{ type: "text", text: "Loaded tools: deferred_exec" }],
			isError: false,
			timestamp: 4,
		},
		{
			role: "system",
			content: "",
			toolsAdded: [deferredExec],
			timestamp: 5,
		},
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
			{ ...(codexModel as object), id: "gpt-5.6-luna", baseUrl: "https://chatgpt.example/backend-api", compat: { supportsMidConvoSystemMessages: true, supportsAdditionalTools: true, supportsToolSearch: true } } as never,
			normalizeContext({ systemPrompt: "Lite instructions", messages, tools: [...codeModeTools, searchToolsTool] } as never),
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
		assert.equal(additionalTools.length, 3);
		assert.deepEqual(additionalTools[1].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(additionalTools[1].tools[0].tools.map((tool: { type: string; name: string; defer_loading?: boolean }) => [tool.type, tool.name, tool.defer_loading]), [
			["function", "example_tool", undefined],
		]);
		assert.deepEqual(additionalTools[2].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(additionalTools[2].tools[0].tools.map((tool: { type: string; name: string; defer_loading?: boolean }) => [tool.type, tool.name, tool.defer_loading]), [
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
		await collectStream(registered.provider.streamSimple(model, normalizeContext({ systemPrompt: "Instructions", messages: [] }), options));
		await collectStream(registered.provider.streamSimple(model, normalizeContext({ systemPrompt: "Instructions", messages: [] }), options));

		assert.equal(capturedHeaders[0]!.get("x-codex-turn-state"), null);
		assert.equal(capturedHeaders[1]!.get("x-codex-turn-state"), "ts-1");
		assert.equal(registered.turnState.current(), "ts-1");
	} finally {
		globalThis.fetch = originalFetch;
	}
});
