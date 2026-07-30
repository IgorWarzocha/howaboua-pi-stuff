import assert from "node:assert/strict";
import test from "node:test";
import { parseSSE } from "../src/providers/openai-codex-custom-provider.ts";
import { parseWebSocket } from "../src/providers/openai-codex/websocket.ts";

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

test("parseWebSocket ignores a malformed frame without dropping the live stream", async () => {
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
	queueMicrotask(() => {
		for (const listener of listeners.get("message") ?? []) {
			listener({ data: "not-json" });
			listener({ data: JSON.stringify({ type: "response.completed", response: { id: "resp_1", status: "completed" } }) });
		}
	});

	const events = [];
	for await (const event of parseWebSocket(socket, undefined)) events.push(event);
	assert.deepEqual(events, [{ type: "response.completed", response: { id: "resp_1", status: "completed" } }]);
});
