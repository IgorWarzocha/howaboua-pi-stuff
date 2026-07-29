import test from "node:test";
import assert from "node:assert/strict";
import { parseSSE } from "../src/providers/openai-codex-custom-provider.ts";
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
