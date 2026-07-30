import test from "node:test";
import assert from "node:assert/strict";
import { parseSSE } from "../src/providers/openai-codex-custom-provider.ts";
import { codexStreamRetryDelay, mapCodexEvents } from "../src/providers/openai-codex/stream-events.ts";
import { parseWebSocket } from "../src/providers/openai-codex/websocket.ts";
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
		(socket) => socket.emitJson({
			type: "response.failed",
			response: { status: "failed", error: { type: "invalid_request_error", status_code: 422, message: "bad request" } },
		}),
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

test("transient streamed failures retry with bounded provider delays", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => socket.emitJson({
			type: "response.failed",
			response: { status: "failed", error: { code: "server_is_overloaded", message: "slow down" } },
		}),
		websocketSuccess,
		(socket) => socket.emitJson({
			type: "response.failed",
			response: { status: "failed", error: { code: "rate_limit_exceeded", message: "Monthly usage limit reached" } },
		}),
	]);
	const originalFetch = globalThis.fetch;
	let fetchCalls = 0;
	globalThis.fetch = (async () => {
		fetchCalls++;
		return sseResponse([]);
	}) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("transient-stream-error");
		const recovered = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(fetchCalls, 0);
		const quotaRequest = codexStreamRequest("terminal-stream-rate-limit");
		const quota = await collectStream(registered.provider.streamSimple(quotaRequest.model, quotaRequest.context, quotaRequest.options));
		assert.equal((quota.at(-1) as { type?: string }).type, "error");
		assert.match(JSON.stringify(quota.at(-1)), /Monthly usage limit reached/);
		assert.equal(ScriptedWebSocket.opened, 3);
		assert.equal(fetchCalls, 0);

		const failed = mapCodexEvents((async function* () {
			yield {
				type: "response.failed",
				response: { error: { code: "rate_limit_exceeded", message: "Please try again in 999999 seconds" } },
			};
		})());
		let rateLimitError: unknown;
		try {
			await failed[Symbol.asyncIterator]().next();
		} catch (error) {
			rateLimitError = error;
		}
		assert.equal(codexStreamRetryDelay(rateLimitError), 60_000);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("WebSocket close 1009 continues through sticky SSE without futile WebSocket retries", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => {
			socket.emit("error", { error: new Error("WebSocket transport failed") });
			queueMicrotask(() => socket.emit("close", { code: 1009, reason: "" }));
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

test("permanent WebSocket handshake failures neither retry nor disable WebSockets", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => socket.emit("error", { message: "Unexpected server response: 401 Unauthorized", status: 401 }),
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
		const request = codexStreamRequest("websocket-auth-session");
		const failed = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((failed.at(-1) as { type?: string }).type, "error");
		assert.match(JSON.stringify(failed.at(-1)), /401 Unauthorized/);
		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(fetchCalls, 0);

		const recovered = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(fetchCalls, 0);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("SSE HTTP routing retries transient rate limits only", async () => {
	const originalFetch = globalThis.fetch;
	let responseIndex = 0;
	const responses = [
		new Response(JSON.stringify({ error: { code: "rate_limit_exceeded", message: "retry shortly" } }), {
			status: 429,
			headers: { "retry-after-ms": "0" },
		}),
		sseResponse([{ type: "response.completed", response: { id: "resp_retry", status: "completed" } }]),
		new Response(JSON.stringify({ error: { code: "unprocessable_entity", message: "invalid body" } }), { status: 422 }),
		new Response(JSON.stringify({ error: { code: "usage_limit_reached", message: "quota exhausted" } }), { status: 429 }),
	];
	globalThis.fetch = (async () => responses[responseIndex++]!) as typeof fetch;
	try {
		const registered = createRegisteredCodexProvider();
		const request = codexStreamRequest("sse-http-routing");
		const options = { ...(request.options as object), transport: "sse", maxRetries: 0 } as never;
		const recovered = await collectStream(registered.provider.streamSimple(request.model, request.context, options));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");

		const permanent = await collectStream(registered.provider.streamSimple(request.model, request.context, options));
		assert.match(JSON.stringify(permanent.at(-1)), /invalid body/);
		const quota = await collectStream(registered.provider.streamSimple(request.model, request.context, options));
		assert.match(JSON.stringify(quota.at(-1)), /usage limit/i);
		assert.equal(responseIndex, 4);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test("WebSocket idle timeout includes asynchronous frame decoding", async () => {
	const listeners = new Map<string, Set<(event: unknown) => void>>();
	const socket = {
		send() {},
		close() {},
		addEventListener(type: string, listener: (event: unknown) => void) {
			const values = listeners.get(type) ?? new Set();
			values.add(listener);
			listeners.set(type, values);
		},
		removeEventListener(type: string, listener: (event: unknown) => void) {
			listeners.get(type)?.delete(listener);
		},
	};
	setTimeout(() => {
		for (const listener of listeners.get("message") ?? []) {
			listener({ data: { arrayBuffer: () => new Promise<ArrayBuffer>(() => undefined) } });
		}
	}, 0);

	await assert.rejects(async () => {
		for await (const _event of parseWebSocket(socket, undefined, 25)) {
			// no decoded event is expected
		}
	}, /WebSocket idle timeout after 25ms/);
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
