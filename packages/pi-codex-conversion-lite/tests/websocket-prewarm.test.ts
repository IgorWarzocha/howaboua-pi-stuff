import test from "node:test";
import assert from "node:assert/strict";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import { buildCachedWebSocketRequestBody, buildRequestBody, prewarmOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import { acquireWebSocket, closeOpenAICodexWebSocketSessions } from "../src/providers/openai-codex/websocket.ts";
import { processWebSocketStream } from "../src/providers/openai-codex/websocket-stream.ts";
import { createInitialAssistantMessage } from "../src/providers/openai-codex/types.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";
import { registerCodexEvents } from "../src/extension/events.ts";
import { createCodexExtensionRuntime } from "../src/extension/runtime.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	static responses: unknown[][] = [];
	readonly sent: string[] = [];
	readonly closes: Array<{ code: number | undefined; reason: string | undefined }> = [];
	readonly options: { headers?: Record<string, string> } | undefined;
	readyState = 0;
	private listeners = new Map<string, Set<(event: unknown) => void>>();
	private pendingResponses: unknown[][] = [];

	constructor(_url: string, options?: { headers?: Record<string, string> }) {
		this.options = options;
		FakeWebSocket.instances.push(this);
		queueMicrotask(() => {
			this.readyState = 1;
			this.emit("open", {});
		});
	}

	addEventListener(type: string, listener: (event: unknown) => void): void {
		const listeners = this.listeners.get(type) ?? new Set();
		listeners.add(listener);
		this.listeners.set(type, listeners);
		if (type === "message") this.deliverResponses();
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		this.sent.push(data);
		this.pendingResponses.push(FakeWebSocket.responses.shift() ?? [
				{ type: "codex.response.metadata", headers: { "x-codex-turn-state": "ts-warm" } },
				{ type: "response.created", response: { id: "resp_warm" } },
				{ type: "response.completed", response: { id: "resp_warm", status: "completed" } },
			]);
		this.deliverResponses();
	}

	close(code?: number, reason?: string): void {
		this.closes.push({ code, reason });
		this.readyState = 3;
	}

	private emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}

	private deliverResponses(): void {
		if (!this.listeners.get("message")?.size) return;
		const responses = this.pendingResponses.shift();
		if (!responses) return;
		queueMicrotask(() => {
			for (const event of responses) this.emit("message", { data: JSON.stringify(event) });
			this.deliverResponses();
		});
	}
}

test("WebSocket prewarm sends generate=false and seeds cached continuation", async () => {
	const originalWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
	FakeWebSocket.responses = [];
	(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as never;
	const turnState = createCodexTurnState();
	const sessionId = "session-prewarm";
	try {
		await prewarmOpenAICodexWebSocket(
			{
				provider: "openai-codex",
				api: "openai-codex-responses",
				id: "gpt-5.4",
				baseUrl: "https://chatgpt.example/backend-api",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 272000,
				maxTokens: 100000,
			} as never,
			{ systemPrompt: "Instructions", messages: [], tools: [] },
			{ apiKey: "eyJhbGciOiJub25lIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xIn19.sig", sessionId },
			{ getConfig: () => ({ openai: { forceCachedWebSockets: true }, beta: { codeMode: false } } as never), turnState },
		);

		const socket = FakeWebSocket.instances[0]!;
		const wire = JSON.parse(socket.sent[0]!);
		const { type: _type, generate: _generate, ...requestBody } = wire;
		assert.equal(wire.generate, false);
		assert.deepEqual(wire.client_metadata, { session_id: sessionId, thread_id: sessionId });
		assert.equal(socket.options?.headers?.["session-id"], sessionId);
		assert.equal(socket.options?.headers?.["thread-id"], sessionId);
		assert.equal(turnState.current(), "ts-warm");
		turnState.beginTurn();
		assert.equal(turnState.current(), "ts-warm");
		turnState.beginTurn();
		assert.equal(turnState.current(), undefined);

		const acquired = await acquireWebSocket("wss://chatgpt.example/backend-api/codex/responses", new Headers(), sessionId, undefined);
		assert.equal(acquired.reused, true);
		assert.deepEqual(acquired.entry?.continuation, {
			lastRequestBody: requestBody,
			lastResponseId: "resp_warm",
			lastResponseItems: [],
		});
		const realBody = buildRequestBody(
			{ provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", reasoning: true, input: ["text"] } as never,
			{ systemPrompt: "Instructions", messages: [{ role: "user", content: "Hello" } as never], tools: [] },
			{ sessionId },
		);
		assert.deepEqual(buildCachedWebSocketRequestBody(acquired.entry?.continuation, realBody), {
			body: { ...realBody, previous_response_id: "resp_warm" },
			decision: "delta",
		});
		acquired.release({ keep: true });
	} finally {
		closeOpenAICodexWebSocketSessions();
		if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
		else delete (globalThis as { WebSocket?: unknown }).WebSocket;
	}
});

test("Code Mode prewarm preserves exec grammar metadata", async () => {
	const originalWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
	FakeWebSocket.responses = [];
	(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as never;
	const sessionId = "code-mode-prewarm";
	const model = {
		provider: "openai-codex",
		api: "openai-codex-responses",
		id: "gpt-5.6-luna",
		baseUrl: "https://chatgpt.example/backend-api",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 272000,
		maxTokens: 100000,
	};
	const pi = {
		getActiveTools: () => ["exec", "wait"],
		getAllTools: () => [
			{ name: "exec", description: "Run JavaScript", parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] } },
			{ name: "wait", description: "Wait", parameters: { type: "object", properties: { cell_id: { type: "string" } }, required: ["cell_id"] } },
		],
		getThinkingLevel: () => "medium",
	};
	const runtime = createCodexExtensionRuntime(pi as never);
	runtime.state.config = {
		...DEFAULT_CODEX_CONVERSION_CONFIG,
		openai: { ...DEFAULT_CODEX_CONVERSION_CONFIG.openai, forceCachedWebSockets: true },
		beta: { ...DEFAULT_CODEX_CONVERSION_CONFIG.beta, codeMode: true, responsesLite: true },
	};
	try {
		await runtime.startPrewarm({
			model,
			cwd: process.cwd(),
			getSystemPrompt: () => "Instructions",
			modelRegistry: {
				getApiKeyAndHeaders: async () => ({ ok: true, apiKey: "eyJhbGciOiJub25lIn0.eyJodHRwczovL2FwaS5vcGVuYWkuY29tL2F1dGgiOnsiY2hhdGdwdF9hY2NvdW50X2lkIjoiYWNjdF8xIn19.sig" }),
			},
			sessionManager: { getSessionId: () => sessionId },
		} as never);

		const wire = JSON.parse(FakeWebSocket.instances[0]!.sent[0]!);
		assert.deepEqual(
			wire.input[0].tools.map((tool: { type: string; name: string }) => [tool.type, tool.name]),
			[["custom", "exec"], ["function", "wait"]],
		);
	} finally {
		runtime.shutdownTransport(sessionId);
		if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
		else delete (globalThis as { WebSocket?: unknown }).WebSocket;
	}
});

test("cached WebSocket retries a missing continuation with full context", async () => {
	const originalWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
	FakeWebSocket.responses = [
		[
			{ type: "codex.rate_limits" },
			{ type: "error", error: { code: "previous_response_not_found", message: "Previous response not found" } },
		],
		[
			{ type: "response.created", response: { id: "resp_recovered" } },
			{ type: "response.completed", response: { id: "resp_recovered", status: "completed", usage: { input_tokens: 1, output_tokens: 0, total_tokens: 1 } } },
		],
	];
	(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as never;
	const sessionId = "missing-continuation";
	const model = { provider: "openai-codex", api: "openai-codex-responses", id: "gpt-5.4", baseUrl: "https://chatgpt.example/backend-api", reasoning: true, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 272000, maxTokens: 100000 } as never;
	const previousBody = buildRequestBody(model, { systemPrompt: "Instructions", messages: [], tools: [] }, { sessionId });
	const body = buildRequestBody(model, { systemPrompt: "Instructions", messages: [{ role: "user", content: "Hello" } as never], tools: [] }, { sessionId });

	try {
		const seeded = await acquireWebSocket("wss://chatgpt.example/backend-api/codex/responses", new Headers(), sessionId, undefined);
		seeded.entry!.continuation = { lastRequestBody: previousBody, lastResponseId: "resp_warm", lastResponseItems: [] };
		seeded.release({ keep: true });
		const output = createInitialAssistantMessage(model);
		let starts = 0;
		await processWebSocketStream("wss://chatgpt.example/backend-api/codex/responses", body, new Headers(), output, createAssistantMessageEventStream(), model, () => { starts++; }, { sessionId, timeoutMs: 1_000, transport: "websocket-cached" });

		assert.equal(FakeWebSocket.instances.length, 2);
		assert.equal(JSON.parse(FakeWebSocket.instances[0]!.sent[0]!).previous_response_id, "resp_warm");
		assert.equal("previous_response_id" in JSON.parse(FakeWebSocket.instances[1]!.sent[0]!), false);
		assert.equal(starts, 1);
		assert.equal(output.responseId, "resp_recovered");
	} finally {
		closeOpenAICodexWebSocketSessions();
		if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
		else delete (globalThis as { WebSocket?: unknown }).WebSocket;
	}
});

test("session shutdown leaves sibling cached WebSockets reusable", async () => {
	const originalWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
	FakeWebSocket.responses = [];
	(globalThis as typeof globalThis & { WebSocket: typeof WebSocket }).WebSocket = FakeWebSocket as never;
	try {
		const handlers = new Map<string, (...args: never[]) => unknown>();
		const pi = {
			on(event: string, handler: (...args: never[]) => unknown) {
				handlers.set(event, handler);
			},
		};
		const runtime = createCodexExtensionRuntime(pi as never);
		registerCodexEvents(
			pi as never,
			runtime,
			{} as never,
			{ clearBackgroundWidget() {} } as never,
			{ shutdown: async () => {} } as never,
			{ shutdown() {} } as never,
		);
		const shutdown = handlers.get("session_shutdown");
		assert.ok(shutdown);

		const childA = await acquireWebSocket("wss://chatgpt.example/codex/responses", new Headers(), "child-a", undefined);
		childA.release({ keep: true });
		const childB = await acquireWebSocket("wss://chatgpt.example/codex/responses", new Headers(), "child-b", undefined);
		childB.release({ keep: true });

		const socketA = FakeWebSocket.instances[0]!;
		const socketB = FakeWebSocket.instances[1]!;
		await shutdown({ type: "session_shutdown", reason: "quit" } as never, {
			sessionManager: { getSessionId: () => "child-a" },
		} as never);

		assert.deepEqual(socketA.closes, [{ code: 1000, reason: "session_shutdown" }]);
		assert.deepEqual(socketB.closes, []);

		const reusedB = await acquireWebSocket("wss://chatgpt.example/codex/responses", new Headers(), "child-b", undefined);
		assert.equal(reusedB.reused, true);
		reusedB.release({ keep: true });

		await shutdown({ type: "session_shutdown", reason: "quit" } as never, {
			sessionManager: { getSessionId: () => "child-b" },
		} as never);
		assert.deepEqual(socketB.closes, [{ code: 1000, reason: "session_shutdown" }]);
	} finally {
		closeOpenAICodexWebSocketSessions();
		if (originalWebSocket) globalThis.WebSocket = originalWebSocket;
		else delete (globalThis as { WebSocket?: unknown }).WebSocket;
	}
});
