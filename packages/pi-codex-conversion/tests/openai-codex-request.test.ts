import test from "node:test";
import assert from "node:assert/strict";
import { buildRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import type { AdapterState } from "../src/adapter/activation/state.ts";
import { rewriteCodexProviderRequest } from "../src/adapter/provider-request.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { CodexContextWindowManager } from "../src/context-management/window-manager.ts";
import {
	CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
	CONTEXT_WINDOW_COMPACTION_SUMMARY,
} from "../src/context-management/messages.ts";
import { createHistoryNotesTools } from "../src/context-management/history-notes.ts";
import {
	CODEX_DEVELOPER_MESSAGE_TYPE,
	isCodexDeveloperMessageDetails,
	registerCodexDeveloperMessageBroker,
	sendCodexDeveloperMessage,
	type CodexDeveloperMessageOptions,
} from "../src/developer-messages.ts";
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

test("Codex provider registration stays route-independent and request shape stable", () => {
	const { registration } = createRegisteredCodexProvider();
	assert.equal(registration.baseUrl, undefined);
	assert.ok(registration.models?.length);
	assert.equal(registration.models.every((model) => model.provider === undefined && model.baseUrl === undefined), true);

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

test("Notebook Mode keeps standard Responses transport and promotes extension developer messages", async () => {
	const handlers = new Map<string, Set<(value: unknown) => void>>();
	const sentMessages: Array<{ message: Record<string, unknown>; options: unknown }> = [];
	const pi = {
		events: {
			on(channel: string, handler: (value: unknown) => void) {
				const listeners = handlers.get(channel) ?? new Set();
				listeners.add(handler);
				handlers.set(channel, listeners);
				return () => listeners.delete(handler);
			},
			emit(channel: string, value: unknown) {
				for (const handler of handlers.get(channel) ?? []) handler(value);
			},
		},
		sendMessage(message: Record<string, unknown>, options: unknown) {
			sentMessages.push({ message, options });
		},
	} as never;
	let developerMessagesActive = true;
	const unregister = registerCodexDeveloperMessageBroker(
		pi,
		() => developerMessagesActive,
	);
	const deliveries = [
		{ deliverAs: "steer", triggerTurn: true },
		{ deliverAs: "followUp", triggerTurn: false },
		{ deliverAs: "nextTurn", triggerTurn: true },
	] satisfies CodexDeveloperMessageOptions[];
	for (const [index, options] of deliveries.entries())
		sendCodexDeveloperMessage(pi, "Developer " + (index + 1), options);
	assert.deepEqual(sentMessages.map(({ options }) => options), deliveries);
	assert.deepEqual(
		sentMessages.map(({ message }) => message["content"]),
		["Developer 1", "Developer 2", "Developer 3"],
	);
	assert.equal(sentMessages.every(({ message }) =>
		message["customType"] === CODEX_DEVELOPER_MESSAGE_TYPE &&
		message["display"] === true &&
		isCodexDeveloperMessageDetails(message["details"])
	), true);

	const developerMessages = new CodexDeveloperMessageBridge();
	const persistedMessages = sentMessages.map(({ message }, index) => ({
		...message,
		role: "custom",
		timestamp: index + 1,
	})) as never;
	assert.deepEqual(developerMessages.prepare(persistedMessages, false), []);
	const projected = developerMessages.prepare(persistedMessages, true);
	const state: AdapterState = {
		enabled: true,
		cwd: "/repo",
		promptSkills: [],
		executionMode: "notebook",
		codexTurnState: createCodexTurnState(),
		developerMessages,
		contextWindows: new CodexContextWindowManager(),
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
		input: projected.map((message) => ({
			role: "user",
			content: [{ type: "input_text", text: (message as { content: string }).content }],
		})),
		text: { verbosity: "low" },
		parallel_tool_calls: true,
	}, ctx, state) as { instructions?: string; input?: unknown[] };

	assert.equal(finalPayload.instructions, "final chained instructions");
	assert.deepEqual(finalPayload.input, [
		{ role: "developer", content: [{ type: "input_text", text: "Developer 1" }] },
		{ role: "developer", content: [{ type: "input_text", text: "Developer 2" }] },
		{ role: "developer", content: [{ type: "input_text", text: "Developer 3" }] },
	]);
	assert.equal(state.activeProviderSystemPrompt, "final chained instructions");
	developerMessagesActive = false;
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Wrong provider"),
		/require an active Responses adapter/,
	);
	unregister();
	assert.throws(
		() => sendCodexDeveloperMessage(pi, "Unavailable"),
		/Pi Codex developer messages are unavailable/,
	);

	const windowMessages: Array<Record<string, unknown>> = [];
	const contextPi = {
		sendMessage(message: Record<string, unknown>) {
			windowMessages.push(message);
		},
	} as never;
	const contextManager = new CodexContextWindowManager(
		async () => "Recovered private checkpoint",
	);
	const contextCtx = {
		cwd: "/repo",
		model: {
			provider: "openai-codex",
			api: "openai-codex-responses",
			id: "gpt-5.6",
			baseUrl: "https://chatgpt.com/backend-api",
			contextWindow: 272_000,
		},
		sessionManager: {
			getBranch: () => [],
			getSessionId: () => "session-context",
		},
		getContextUsage: () => ({
			tokens: 12_000,
			contextWindow: 272_000,
			percent: 4.4,
		}),
		isIdle: () => true,
	} as never;
	contextManager.ensureInitialized(contextPi, contextCtx, true);
	assert.equal(await contextManager.startNewWindow(contextPi, contextCtx, {
		triggerTurn: false,
		mode: "hybrid",
	}), true);
	assert.equal(windowMessages.length, 2);
	assert.equal(
		windowMessages.every(
			(message) => message["customType"] === CODEX_CONTEXT_WINDOW_MESSAGE_TYPE,
		),
		true,
	);
	const contextAgentMessages = [
		{ role: "user", content: "old", timestamp: 1 },
		...windowMessages.map((message, index) => ({
			...message,
			role: "custom",
			timestamp: index + 2,
		})),
	] as never;
	const activeWindow = contextManager.project(contextAgentMessages, true);
	assert.equal(activeWindow.length, 1);
	assert.match((activeWindow[0] as { content: string }).content, /Recovered private checkpoint/);
	assert.deepEqual(contextManager.remaining(contextCtx), {
		remainingTokens: 243_616,
		windowId: (windowMessages[1]?.["details"] as {
			contextManagement: { currentWindowId: string };
		}).contextManagement.currentWindowId,
		contextWindow: 255_616,
	});

	const contextBridge = new CodexDeveloperMessageBridge();
	const contextState: AdapterState = {
		...state,
		executionMode: "notebook",
		developerMessages: contextBridge,
		contextWindows: contextManager,
		config: {
			...DEFAULT_CODEX_CONVERSION_CONFIG,
			compaction: {
				...DEFAULT_CODEX_CONVERSION_CONFIG.compaction,
				contextManagement: "hybrid",
			},
		},
	};
	const carriers = contextBridge.prepare(activeWindow, true);
	const contextRouterTools = buildRequestBody(codexModel, {
		messages: [],
		tools: createHistoryNotesTools(),
	} as never).tools;
	const contextPayload = await rewriteCodexProviderRequest(
		{
			model: "gpt-5.6",
			tools: contextRouterTools,
			input: carriers.map((message) => ({
				role: "user",
				content: [{
					type: "input_text",
					text: (message as { content: string }).content,
				}],
			})),
		},
		contextCtx,
		contextState,
	) as {
		input: Array<{ role: string }>;
		client_metadata: Record<string, string>;
		tools: Array<{
			type: string;
			name: string;
			tools: Array<{
				name: string;
				parameters: { properties: Record<string, Record<string, unknown>> };
			}>;
		}>;
	};
	assert.deepEqual(contextPayload.input.map(({ role }) => role), ["developer"]);
	assert.deepEqual(
		contextPayload.tools.map((namespace) => [
			namespace.type,
			namespace.name,
			namespace.tools.map((tool) => tool.name),
		]),
		[
			["namespace", "history", ["list_windows", "list_items", "read_item", "search_contents"]],
			["namespace", "notes", ["list_files_by_prefix", "read_file", "search_contents", "append_to_file", "write_file"]],
		],
	);
	const remoteWrite = contextPayload.tools[1]!.tools.find(
		(tool) => tool.name === "write_file",
	)!;
	assert.equal(remoteWrite.parameters.properties["text"]?.["encrypted"], true);
	assert.equal("action" in remoteWrite.parameters.properties, false);
	assert.deepEqual(
		JSON.parse(contextPayload.client_metadata["x-codex-turn-metadata"]!),
		{
			session_id: "session-context",
			thread_id: "session-context",
			agent_name: "/root",
			window_id: "session-context:1",
			window_number: 1,
			context_window_id: (windowMessages[1]?.["details"] as {
				contextManagement: { currentWindowId: string };
			}).contextManagement.currentWindowId,
			request_kind: "turn",
			history_ingest_requested: true,
		},
	);
	assert.deepEqual(
		contextManager.createCompaction({
			branchEntries: windowMessages.map((message, index) => ({
				type: "custom_message",
				id: `entry-${index}`,
				parentId: index === 0 ? null : `entry-${index - 1}`,
				timestamp: new Date(index).toISOString(),
				customType: message["customType"],
				content: message["content"],
				display: message["display"],
				details: message["details"],
			})),
			preparation: {
				firstKeptEntryId: "default-cut",
				tokensBefore: 240_000,
			},
		} as never),
		{
			summary: CONTEXT_WINDOW_COMPACTION_SUMMARY,
			firstKeptEntryId: "entry-1",
			tokensBefore: 240_000,
			details: {
				protocol: 1,
				strategy: "codex-context-window",
				windowId: (windowMessages[1]?.["details"] as {
					contextManagement: { currentWindowId: string };
				}).contextManagement.currentWindowId,
			},
		},
	);

	const originalFetch = globalThis.fetch;
	let historyRequest:
		| { url: string; init: RequestInit }
		| undefined;
	try {
		globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
			historyRequest = { url: String(input), init: init ?? {} };
			return new Response(
				JSON.stringify({ encrypted_output: "encrypted-note" }),
				{ status: 200 },
			);
		}) as typeof fetch;
		const token = fakeJwt({
			"https://api.openai.com/auth": { chatgpt_account_id: "account-1" },
		});
		const [history, notes] = createHistoryNotesTools();
		const noteResult = await notes.execute(
			"note-call",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			{
				...(contextCtx as unknown as Record<string, unknown>),
				modelRegistry: {
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: token,
						baseUrl: "https://chatgpt.com/backend-api",
					}),
				},
			} as never,
		);
		assert.deepEqual(noteResult.details, {
			codexHistoryNotes: { encrypted_output: "encrypted-note" },
		});
		assert.equal(
			historyRequest?.url,
			"https://chatgpt.com/backend-api/codex/alpha/notes/v2/write_file",
		);
		const requestHeaders = new Headers(historyRequest?.init.headers);
		assert.equal(
			requestHeaders.get("x-openai-encrypted-tool-arguments"),
			"true",
		);
		assert.equal(
			requestHeaders.get("x-openai-tool-output-truncation-policy"),
			JSON.stringify({ mode: "tokens", limit: 10_000 }),
		);
		assert.deepEqual(JSON.parse(String(historyRequest?.init.body)), {
			path: "checkpoint.md",
			text: "progress",
			context: {
				session_id: "session-context",
				current_agent_name: "/root",
			},
		});
		globalThis.fetch = (async () => new Response(
			JSON.stringify({ detail: "Not found" }),
			{ status: 404 },
		)) as typeof fetch;
		const firstWindowId = (windowMessages[0]?.["details"] as {
			contextManagement: { currentWindowId: string };
		}).contextManagement.currentWindowId;
		const fallback = await history.execute(
			"history-call",
			{ action: "list_items", window_id: firstWindowId },
			undefined,
			undefined,
			{
				...(contextCtx as unknown as Record<string, unknown>),
				sessionManager: {
					getSessionId: () => "session-context",
					getBranch: () => [
						{
							type: "custom_message",
							id: "window-entry",
							parentId: null,
							timestamp: new Date(0).toISOString(),
							...windowMessages[0],
						},
						{
							type: "message",
							id: "user-entry",
							parentId: "window-entry",
							timestamp: new Date(1).toISOString(),
							message: { role: "user", content: "recover me", timestamp: 1 },
						},
					],
				},
				modelRegistry: {
					getApiKeyAndHeaders: async () => ({
						ok: true,
						apiKey: token,
						baseUrl: "https://chatgpt.com/backend-api",
					}),
				},
			} as never,
		);
		assert.deepEqual(fallback.details.codexHistoryNotes, {
			source: "pi-session",
			items: [{
				window_id: firstWindowId,
				item_id: "user-entry",
				role: "user",
				truncated_content: "recover me",
				content_chars: 10,
			}],
		});

		const localPayload = await rewriteCodexProviderRequest({
			model: "gpt-5.6",
			input: [],
			tools: contextRouterTools,
		}, contextCtx, contextState) as {
			client_metadata?: unknown;
			tools: Array<{
				type: string;
				name: string;
				parameters: { properties: Record<string, Record<string, unknown>> };
			}>;
		};
		assert.deepEqual(
			localPayload.tools.map((tool) => [tool.type, tool.name]),
			[["function", "history"], ["function", "notes"]],
		);
		const localNotesRouter = localPayload.tools[1]!;
		assert.equal("action" in localNotesRouter.parameters.properties, true);
		assert.equal(
			"encrypted" in localNotesRouter.parameters.properties["text"]!,
			false,
		);
		assert.equal(localPayload.client_metadata, undefined);

		const noteEntries: Array<Record<string, unknown>> = [];
		const localPi = {
			appendEntry(customType: string, data: unknown) {
				noteEntries.push({
					type: "custom",
					id: `note-${noteEntries.length + 1}`,
					parentId: null,
					timestamp: new Date(noteEntries.length).toISOString(),
					customType,
					data,
				});
			},
		} as never;
		const localContext = {
			...(contextCtx as unknown as Record<string, unknown>),
			model: {
				provider: "passthrough",
				api: "openai-responses",
				id: "gpt-5.6",
			},
			sessionManager: {
				getSessionId: () => "session-local-notes",
				getBranch: () => noteEntries,
			},
		} as never;
		const [, localNotes] = createHistoryNotesTools(localPi, () => "local");
		const localNamespacePayload = await rewriteCodexProviderRequest({
			model: "gpt-5.6",
			input: [],
			tools: contextRouterTools,
		}, localContext, {
			...contextState,
			config: {
				...contextState.config,
				scope: { allProviders: "on", additionalProviders: [] },
				compaction: {
					...contextState.config.compaction,
					contextManagement: "local",
				},
			},
		}) as { tools: typeof contextPayload.tools };
		const localNamespaceWrite = localNamespacePayload.tools[1]!.tools.find(
			(tool) => tool.name === "write_file",
		)!;
		assert.equal(
			"encrypted" in localNamespaceWrite.parameters.properties["text"]!,
			false,
		);
		await localNotes.execute(
			"write-note",
			{ action: "write_file", path: "checkpoint.md", text: "progress" },
			undefined,
			undefined,
			localContext,
		);
		await localNotes.execute(
			"append-note",
			{ action: "append_to_file", path: "checkpoint.md", text: "\nnext" },
			undefined,
			undefined,
			localContext,
		);
		const localRead = await localNotes.execute(
			"read-note",
			{ action: "read_file", path: "/root/notes/checkpoint.md" },
			undefined,
			undefined,
			localContext,
		);
		assert.equal(
			(localRead.details.codexHistoryNotes["file"] as { content: string }).content,
			"progress\nnext",
		);
		assert.deepEqual(
			noteEntries.map((entry) => [entry["type"], entry["customType"]]),
			[
				["custom", "codex-context-note"],
				["custom", "codex-context-note"],
			],
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
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
			addedToolNames: ["deferred_exec"],
			isError: false,
			timestamp: 4,
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
		assert.equal(additionalTools.length, 3);
		assert.deepEqual(additionalTools[1].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(additionalTools[1].tools[0].tools.map((tool: { type: string; name: string; defer_loading?: boolean }) => [tool.type, tool.name, tool.defer_loading]), [
			["function", "example_tool", undefined],
		]);
		assert.deepEqual(additionalTools[2].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]), [["namespace", "functions"]]);
		assert.deepEqual(additionalTools[2].tools[0].tools.map((tool: { type: string; name: string; defer_loading?: boolean }) => [tool.type, tool.name, tool.defer_loading]), [
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
