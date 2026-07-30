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

test("fatal Codex API errors do not arm fallback and malformed frames are ignored", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => socket.emitJson({ type: "error", status: 400, code: "invalid_request", message: "bad request" }),
		websocketSuccess,
		(socket) => {
			socket.emit("message", { data: "not-json" });
			websocketSuccess(socket);
		},
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
		const recovered = await collectStream(registered.provider.streamSimple(protocolRequest.model, protocolRequest.context, protocolRequest.options));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 3);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("SSE body recovery replays turn state and commits only the completed attempt", async () => {
	const originalFetch = globalThis.fetch;
	const encoder = new TextEncoder();
	const capturedHeaders: Headers[] = [];
	const completedItems: unknown[] = [];
	let fetchCalls = 0;
	try {
		globalThis.fetch = (async (_url, init) => {
			fetchCalls++;
			capturedHeaders.push(new Headers(init?.headers));
			if (fetchCalls === 1) {
				let pulled = false;
				return new Response(new ReadableStream({
					pull(controller) {
						if (pulled) {
							controller.error(new Error("SSE body disconnected"));
							return;
						}
						pulled = true;
						controller.enqueue(encoder.encode(`data: ${JSON.stringify({
							type: "response.output_item.done",
							item: { type: "message", id: "discarded" },
						})}\n\n`));
					},
				}), { headers: { "content-type": "text/event-stream", "x-codex-turn-state": "retry-state" } });
			}
			return sseResponse([
				{ type: "response.output_item.done", item: { type: "message", id: "committed", role: "assistant", status: "completed", content: [] } },
				{ type: "response.completed", response: { id: "resp_recovered", status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } } },
			]);
		}) as typeof fetch;

		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("sse-body-retry");
		const events = await collectStream(registered.provider.streamSimple(
			request.model,
			request.context,
			{ ...(request.options as object), transport: "sse", onOutputItemDone: (item: unknown) => completedItems.push(item) } as never,
		));

		assert.equal((events.at(-1) as { type?: string }).type, "done");
		assert.equal(fetchCalls, 2);
		assert.equal(capturedHeaders[0]?.get("x-codex-turn-state"), null);
		assert.equal(capturedHeaders[1]?.get("x-codex-turn-state"), "retry-state");
		assert.deepEqual(completedItems, [{ type: "message", id: "committed", role: "assistant", status: "completed", content: [] }]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
