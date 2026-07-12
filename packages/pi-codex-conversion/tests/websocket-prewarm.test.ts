import test from "node:test";
import assert from "node:assert/strict";
import { buildCachedWebSocketRequestBody, buildRequestBody, prewarmOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import { acquireWebSocket, closeOpenAICodexWebSocketSessions } from "../src/providers/openai-codex/websocket.ts";
import { createCodexTurnState } from "../src/providers/openai-codex/turn-state.ts";

class FakeWebSocket {
	static instances: FakeWebSocket[] = [];
	readonly sent: string[] = [];
	readonly options: { headers?: Record<string, string> } | undefined;
	readyState = 0;
	private listeners = new Map<string, Set<(event: unknown) => void>>();

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
	}

	removeEventListener(type: string, listener: (event: unknown) => void): void {
		this.listeners.get(type)?.delete(listener);
	}

	send(data: string): void {
		this.sent.push(data);
		setTimeout(() => {
			for (const event of [
				{ type: "codex.response.metadata", headers: { "x-codex-turn-state": "ts-warm" } },
				{ type: "response.created", response: { id: "resp_warm" } },
				{ type: "response.completed", response: { id: "resp_warm", status: "completed" } },
			]) this.emit("message", { data: JSON.stringify(event) });
		}, 0);
	}

	close(): void {
		this.readyState = 3;
	}

	private emit(type: string, event: unknown): void {
		for (const listener of this.listeners.get(type) ?? []) listener(event);
	}
}

test("WebSocket prewarm sends generate=false and seeds cached continuation", async () => {
	const originalWebSocket = globalThis.WebSocket;
	FakeWebSocket.instances = [];
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
