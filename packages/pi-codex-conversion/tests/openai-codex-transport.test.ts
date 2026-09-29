import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import test from "node:test";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { prewarmPreparedOpenAICodexWebSocket } from "../src/providers/openai-codex-custom-provider.ts";
import { parseErrorResponse } from "../src/providers/openai-codex/errors.ts";
import { createCodexHttpError, isRetryableCodexStreamError } from "../src/providers/openai-codex/stream-events.ts";
import {
	ScriptedWebSocket,
	codexStreamRequest,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
	sseResponse,
	websocketSuccess,
} from "./openai-codex-test-support.ts";

test("fatal Codex API errors survive both event shapes without SSE fallback", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		(socket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_failed" } });
			socket.emitJson({
				type: "response.failed",
				response: { status: "failed", error: { type: "context_length_exceeded", status_code: 400, message: "context_length_exceeded" } },
			});
		},
		(socket) => {
			socket.emitJson({ type: "response.created", response: { id: "resp_blocked" } });
			socket.emitJson({
				type: "error",
				code: "invalid_prompt",
				message: "Request blocked.",
			});
		},
		(socket) => socket.emitJson({ type: "error", code: "flex_unavailable" }),
		(socket) => socket.emitJson({ type: "response.failed", response: { error: { code: "flex_unavailable", message: "Flex is full." } } }),
		websocketSuccess,
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
		const overflow = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((overflow.at(-1) as { type?: string }).type, "error");
		assert.match((overflow.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage ?? "", /context_length_exceeded/);

		const blocked = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
		assert.equal((blocked.at(-1) as { type?: string }).type, "error");
		assert.equal(
			(blocked.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage,
			"OpenAI blocked this request (invalid_prompt - reason unknown).",
		);
		for (const expected of ["Codex error: Flex capacity unavailable.", "Flex is full."]) {
			const flex = await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));
			assert.equal((flex.at(-1) as { type?: string }).type, "error");
			assert.equal((flex.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage, expected);
		}
		await collectStream(registered.provider.streamSimple(request.model, request.context, request.options));

		assert.equal(ScriptedWebSocket.opened, 5);
		assert.equal(fetchCalls, 0);
		globalThis.fetch = (async () => {
			fetchCalls++;
			return sseResponse([{ type: "response.failed", response: { error: { code: "flex_unavailable" } } }]);
		}) as typeof fetch;
		const flex = await collectStream(registered.provider.streamSimple(request.model, request.context, { ...request.options as object, transport: "sse" } as never));
		assert.equal((flex.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage, "Flex capacity unavailable.");
		assert.equal(fetchCalls, 1);
		for (const transport of ["websocket", "sse"]) {
			let observations = 0;
			const failedObserver = await collectStream(registered.provider.streamSimple(request.model, request.context, {
				...request.options as object, transport,
				async onProviderStreamEvent() { observations++; throw new Error("observer rejected event: message too big"); },
			} as never));
			assert.match((failedObserver.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage ?? "", /observer rejected event/);
			assert.equal(observations, 1);
		}
		assert.equal(ScriptedWebSocket.opened, 6, "observer failures must not retry the generation");
		assert.equal(fetchCalls, 2, "observer failures must not fall back or retry SSE");
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
	const parsed = await parseErrorResponse(new Response(JSON.stringify({
		error: { code: "bio_policy" },
	}), { status: 400 }));
	assert.equal(parsed.message, "This content was flagged for possible biological risk.");
	assert.equal(isRetryableCodexStreamError(createCodexHttpError(parsed.message, parsed.code, 400)), false);
	const flex = await parseErrorResponse(new Response('{"error":{"code":"flex_unavailable"}}', { status: 429 }));
	assert.equal(flex.message, "Flex capacity unavailable.");
	assert.equal(isRetryableCodexStreamError(createCodexHttpError(flex.message, flex.code, 429)), false);
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
		const registered = createRegisteredCodexProvider({
			beforeRequestSend: async (model, _context, body, options, responsesLite) => {
				if (!options) return;
				await prewarmPreparedOpenAICodexWebSocket(model, body, options, responsesLite, {
					getConfig: () => ({ executionMode: "normal", openai: DEFAULT_CODEX_CONVERSION_CONFIG.openai }),
				});
			},
		});
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

test("SSE recovery honors server deadlines, replays turn state and commits only the completed attempt", async (t) => {
	t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.UTC(2026, 8, 28) });
	let now = 0;
	t.mock.method(performance, "now", () => now);
	const advance = (ms: number) => { now += ms; t.mock.timers.tick(ms); };
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
				return new Response("Temporarily unavailable", {
					status: 503, headers: { "Retry-After": new Date(Date.now() + 30_000).toUTCString() },
				});
			}
			if (fetchCalls === 2) {
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
		const pending = collectStream(registered.provider.streamSimple(
			request.model,
			request.context,
			{
				...(request.options as object), transport: "sse", onOutputItemDone: (item: unknown) => completedItems.push(item),
				onResponse: ({ status }: { status: number }) => { if (status === 503) advance(10_000); },
			} as never,
		));
		await setImmediate();
		assert.equal(fetchCalls, 1);
		advance(19_999);
		await setImmediate();
		assert.equal(fetchCalls, 1);
		advance(1);
		await setImmediate();
		assert.equal(fetchCalls, 2);
		advance(1_000);
		const events = await pending;

		assert.equal((events.at(-1) as { type?: string }).type, "done");
		assert.equal(fetchCalls, 3);
		assert.equal(capturedHeaders[0]?.get("x-codex-turn-state"), null);
		assert.equal(capturedHeaders[1]?.get("x-codex-turn-state"), null);
		assert.equal(capturedHeaders[2]?.get("x-codex-turn-state"), "retry-state");
		assert.deepEqual(completedItems, [{ type: "message", id: "committed", role: "assistant", status: "completed", content: [] }]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});
