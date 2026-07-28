import test from "node:test";
import assert from "node:assert/strict";
import { closeOpenAICodexWebSocketSessions, parseSSE } from "../src/providers/openai-codex-custom-provider.ts";
import {
	ScriptedWebSocket,
	codexStreamRequest,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
	sseResponse,
	websocketSuccess,
} from "./openai-codex-test-support.ts";

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

test("a post-start WebSocket failure makes SSE sticky only for that session until reset", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_failed" } });
			socket.emit("error", { error: new Error("socket reset by peer") });
		},
		websocketSuccess,
		websocketSuccess,
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([{ type: "response.completed", response: { id: "resp_sse", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } }]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const sessionA = codexStreamRequest("session-a");
		const failed = await collectStream(registered.provider.streamSimple(sessionA.model, sessionA.context, sessionA.options));
		assert.match((failed.at(-1) as { error: { errorMessage: string } }).error.errorMessage, /Connection error: WebSocket error: socket reset by peer/);
		assert.equal(fetchCalls, 0);

		await collectStream(registered.provider.streamSimple(sessionA.model, sessionA.context, sessionA.options));
		assert.equal(fetchCalls, 1);
		assert.equal(ScriptedWebSocket.opened, 1);

		const sessionB = codexStreamRequest("session-b");
		await collectStream(registered.provider.streamSimple(sessionB.model, sessionB.context, sessionB.options));
		assert.equal(ScriptedWebSocket.opened, 2);

		closeOpenAICodexWebSocketSessions("session-a");
		await collectStream(registered.provider.streamSimple(sessionA.model, sessionA.context, sessionA.options));
		assert.equal(ScriptedWebSocket.opened, 3);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("Codex API and protocol errors do not arm SSE fallback", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => socket.emitJson({ type: "error", code: "invalid_request", message: "bad request" }),
		websocketSuccess,
		(socket) => socket.emit("message", { data: "not-json" }),
		websocketSuccess,
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("api-error-session");
		const failed = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.match(JSON.stringify(failed), /bad request/);
		await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));

		const protocolRequest = codexStreamRequest("protocol-error-session");
		const malformed = await collectStream(registered.provider.streamSimple(protocolRequest.model, protocolRequest.context, protocolRequest.options));
		assert.match(JSON.stringify(malformed), /Invalid Codex WebSocket JSON/);
		await collectStream(registered.provider.streamSimple(protocolRequest.model, protocolRequest.context, protocolRequest.options));
		assert.equal(ScriptedWebSocket.opened, 4);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});
