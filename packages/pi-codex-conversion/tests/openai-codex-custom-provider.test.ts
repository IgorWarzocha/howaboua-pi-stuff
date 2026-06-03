import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	buildProviderErrorMessage,
	buildRequestBody,
	buildCachedWebSocketRequestBody,
	getEffectiveCodexTransport,
	requestBodyForWebSocketContinuationComparison,
	createActivityMessageDispatcher,
	buildGeneratedImageDisplayText,
	buildWebSearchActivityMessage,
	buildWebSearchSummaryText,
	getOpenAICodexLatestImagePath,
	getOpenAICodexImagePath,
	parseSSE,
	saveOpenAICodexGeneratedImage,
} from "../src/providers/openai-codex-custom-provider.ts";

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

async function waitForTimers(): Promise<void> {
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

test("buildRequestBody sends a non-empty fallback system prompt", () => {
	const body = buildRequestBody(codexModel, { systemPrompt: "", messages: [] });
	assert.equal(body.instructions, "You are a helpful assistant.");
});

test("buildRequestBody preserves provided system prompts", () => {
	const body = buildRequestBody(codexModel, { systemPrompt: "Custom instructions", messages: [] });
	assert.equal(body.instructions, "Custom instructions");
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

test("getOpenAICodexImagePath saves images under the repo-local .pi/openai-codex-images directory", () => {
	const filePath = getOpenAICodexImagePath("/repo", "resp_123", "ig_456", "png");
	assert.equal(filePath, path.join("/repo", ".pi", "openai-codex-images", "ig_456-resp_123.png"));
});

test("getOpenAICodexImagePath shortens long codex ids for friendlier filenames", () => {
	const filePath = getOpenAICodexImagePath(
		"/repo",
		"resp_05d6d2731de96e7d0169e6d4bb06d88191adb685d17c2e4e9b",
		"ig_05d6d2731de96e7d0169e6d4bc910081918539a5b24943cd3c",
		"png",
	);
	assert.equal(filePath, path.join("/repo", ".pi", "openai-codex-images", "ig_05d6d273-cd3c-resp_05d6d273-4e9b.png"));
});

test("getOpenAICodexImagePath falls back to png for unsafe image output formats", () => {
	const filePath = getOpenAICodexImagePath("/repo", "resp_123", "ig_456", "../../evil");
	assert.equal(filePath, path.join("/repo", ".pi", "openai-codex-images", "ig_456-resp_123.png"));
});
test("buildGeneratedImageDisplayText surfaces the prompt and saved filename to the user", () => {
	assert.equal(
		buildGeneratedImageDisplayText({
			absolutePath: "/repo/.pi/openai-codex-images/ig_456-resp_123.png",
			relativePath: ".pi/openai-codex-images/ig_456-resp_123.png",
			latestAbsolutePath: "/repo/.pi/openai-codex-images/latest.png",
			latestRelativePath: ".pi/openai-codex-images/latest.png",
			responseId: "resp_123",
			callId: "ig_456",
			outputFormat: "png",
			revisedPrompt: "A tiny red square icon",
		}),
		"File: .pi/openai-codex-images/ig_456-resp_123.png",
	);
	assert.equal(
		buildGeneratedImageDisplayText(
			{
				absolutePath: "/repo/.pi/openai-codex-images/ig_456-resp_123.png",
				relativePath: ".pi/openai-codex-images/ig_456-resp_123.png",
				latestAbsolutePath: "/repo/.pi/openai-codex-images/latest.png",
				latestRelativePath: ".pi/openai-codex-images/latest.png",
				responseId: "resp_123",
				callId: "ig_456",
				outputFormat: "png",
				revisedPrompt: "A tiny red square icon",
			},
			{ expanded: true },
		),
		"Prompt: A tiny red square icon\nFile: .pi/openai-codex-images/ig_456-resp_123.png",
	);
});

test("buildWebSearchActivityMessage surfaces the executed query and best sources", () => {
	assert.equal(
		buildWebSearchActivityMessage([
			{
				callId: "ws_123",
				status: "completed",
				query: "latest SpaceX launch",
				queries: ["latest SpaceX launch"],
				sources: [
					{ title: "SpaceX launches two Starlink satellite groups 19 hours apart", url: "https://www.space.com/example" },
					{ url: "https://example.com/fallback" },
				],
			},
		]),
		[
			"Web search results",
			"Queries:",
			"- latest SpaceX launch",
			"Sources:",
			"- SpaceX launches two Starlink satellite groups 19 hours apart — https://www.space.com/example",
			"- https://example.com/fallback",
		].join("\n"),
	);
});

test("buildWebSearchSummaryText collapses merged searches into one summary line", () => {
	assert.equal(buildWebSearchSummaryText([]), "Searched the web 0 times");
	assert.equal(
		buildWebSearchSummaryText([
			{ callId: "ws_123", queries: ["latest SpaceX launch"], sources: [] },
		]),
		"Searched the web once",
	);
	assert.equal(
		buildWebSearchSummaryText([
			{ callId: "ws_123", queries: ["a"], sources: [] },
			{ callId: "ws_456", queries: ["b"], sources: [] },
			{ callId: "ws_789", queries: ["c"], sources: [] },
		]),
		"Searched the web 3 times",
	);
});

test("activity dispatcher defers display messages until an idle agent_end flush", async () => {
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const dispatcher = createActivityMessageDispatcher((message, options) => {
		sentMessages.push({ message, options });
	});
	type SettledActivities = Parameters<typeof dispatcher.enqueueSettledActivities>[0];

	let isStreaming = true;
	dispatcher.enqueueSettledActivities([
		{
			kind: "web-search",
			search: {
				callId: "ws_123",
				queries: ["latest SpaceX launch"],
				sources: [{ title: "Launch report", url: "https://example.com/launch" }],
			},
		},
	] satisfies SettledActivities);

	assert.equal(sentMessages.length, 0, "settled stream must not send custom messages while Pi is still streaming");
	await waitForTimers();
	assert.equal(sentMessages.length, 0, "no flush is scheduled before agent_end");

	isStreaming = false;
	dispatcher.scheduleFlush();
	assert.equal(sentMessages.length, 0, "agent_end flush is deferred to the next task");
	await waitForTimers();

	assert.equal(isStreaming, false);
	assert.equal(sentMessages.length, 1);
	assert.deepEqual(sentMessages[0]!?.options, { triggerTurn: false });
	assert.equal((sentMessages[0]!?.message as { customType?: string }).customType, "codex-web-search-activity");
});

test("activity dispatcher flushes queued display messages before shutdown clear", async () => {
	const sentMessages: Array<{ message: unknown; options: unknown }> = [];
	const dispatcher = createActivityMessageDispatcher((message, options) => {
		sentMessages.push({ message, options });
	});
	type SettledActivities = Parameters<typeof dispatcher.enqueueSettledActivities>[0];

	dispatcher.enqueueSettledActivities([
		{
			kind: "web-search",
			search: {
				callId: "ws_123",
				queries: ["latest SpaceX launch"],
				sources: [{ title: "Launch report", url: "https://example.com/launch" }],
			},
		},
	] satisfies SettledActivities);
	dispatcher.scheduleFlush();
	dispatcher.flushNow();
	dispatcher.clear();
	await waitForTimers();

	assert.equal(sentMessages.length, 1);
	assert.deepEqual(sentMessages[0]!?.options, { triggerTurn: false });
	assert.equal((sentMessages[0]!?.message as { customType?: string }).customType, "codex-web-search-activity");
});

test("saveOpenAICodexGeneratedImage writes the decoded image bytes into the workspace-local cache", async () => {
	const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "pi-codex-image-test-"));
	const encoded = Buffer.from("png-bytes").toString("base64");

	try {
		const saved = await saveOpenAICodexGeneratedImage(cwd, {
			responseId: "resp_123",
			callId: "ig_456",
			result: encoded,
			outputFormat: "png",
		});

		assert.equal(saved.relativePath, path.join(".pi", "openai-codex-images", "ig_456-resp_123.png"));
		assert.equal(saved.latestRelativePath, path.join(".pi", "openai-codex-images", "latest.png"));
		assert.deepEqual(await fs.readFile(saved.absolutePath), Buffer.from("png-bytes"));
		assert.deepEqual(await fs.readFile(getOpenAICodexLatestImagePath(cwd)), Buffer.from("png-bytes"));
	} finally {
		await fs.rm(cwd, { recursive: true, force: true });
	}
});

test("saveOpenAICodexGeneratedImage anchors generated images to the repo root when cwd is a subdirectory", async () => {
	const repoRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pi-codex-image-root-"));
	const nestedCwd = path.join(repoRoot, "packages", "feature");
	const encoded = Buffer.from("png-bytes").toString("base64");

	try {
		await fs.mkdir(path.join(repoRoot, ".git"), { recursive: true });
		await fs.mkdir(nestedCwd, { recursive: true });

		const saved = await saveOpenAICodexGeneratedImage(nestedCwd, {
			responseId: "resp_123",
			callId: "ig_456",
			result: encoded,
			outputFormat: "png",
		});

		assert.equal(saved.absolutePath, path.join(repoRoot, ".pi", "openai-codex-images", "ig_456-resp_123.png"));
		assert.equal(saved.relativePath, path.join(".pi", "openai-codex-images", "ig_456-resp_123.png"));
		assert.deepEqual(await fs.readFile(saved.absolutePath), Buffer.from("png-bytes"));
	} finally {
		await fs.rm(repoRoot, { recursive: true, force: true });
	}
});
