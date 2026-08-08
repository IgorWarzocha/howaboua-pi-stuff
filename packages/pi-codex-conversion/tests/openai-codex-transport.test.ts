import assert from "node:assert/strict";
import test from "node:test";
import {
	ScriptedWebSocket,
	codexStreamRequest,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
	sseResponse,
	websocketSuccess,
} from "./openai-codex-test-support.ts";

test("fatal Codex API errors survive stream start without SSE fallback", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_failed" } });
			socket.emitJson({
				type: "response.failed",
				response: { status: "failed", error: { type: "context_length_exceeded", status_code: 400, message: "context_length_exceeded" } },
			});
		},
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
		assert.equal((failed.at(-1) as { type?: string }).type, "error");
		assert.match((failed.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage ?? "", /context_length_exceeded/);
		await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));

		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("WebSocket 401 fallback remains local to the failed turn", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => socket.emitError({ message: "Unexpected server response: 401 Unauthorized", status: 401 }),
		websocketSuccess,
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([{ type: "response.completed", response: { id: `resp_sse_${fetchCalls}`, status: "completed" } }]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("websocket-auth-session");
		await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(fetchCalls, 1);

		await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(fetchCalls, 1);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("WebSocket close 1009 continues through sticky SSE without futile WebSocket retries", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => {
			socket.emit("error", { error: new Error("WebSocket transport failed") });
			setTimeout(() => socket.emit("close", { code: 1009, reason: "" }), 50);
		},
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([{
			type: "response.completed",
			response: { id: `resp_sse_${fetchCalls}`, status: "completed", usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } },
		}]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("message-too-big-session");
		const recovered = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(fetchCalls, 1);

		const continued = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((continued.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(fetchCalls, 2);
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
