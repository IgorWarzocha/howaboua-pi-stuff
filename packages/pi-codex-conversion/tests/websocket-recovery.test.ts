import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
	sseResponse,
} from "./openai-codex-test-support.ts";
import {
	context,
	doneMessage,
	model,
	sentFrames,
	streamOptions,
	textResponse,
	unfinishedResponse,
	upgradeRequired,
	user,
} from "./websocket-test-support.ts";

test("WebSocket 426 falls back to sticky SSE without retrying", async () => {
	const restoreWebSocket = installScriptedWebSocket([upgradeRequired]);
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
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "upgrade-required";
		const requestContext = context([user("same user", 1)]);

		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));

		assert.equal(ScriptedWebSocket.opened, 1);
		assert.equal(fetchCalls, 2);
	} finally {
		globalThis.fetch = originalFetch;
		restoreWebSocket();
	}
});

test("unfinished WebSocket responses retry without seeding a continuation", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		unfinishedResponse("resp_pending", "in_progress"),
		[
			textResponse("resp_recovered", "recovered"),
			textResponse("resp_continued", "continued"),
		],
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "unfinished-continuation";
		const requestContext = context([user("same user", 1)]);
		const recovered = await collectStream(registered.provider.streamSimple(
			model as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));
		assert.equal((recovered.at(-1) as { type?: string }).type, "done");
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
		const recoveredMessage = doneMessage(recovered);

		await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("same user", 1), recoveredMessage as AgentMessage, user("next user", 2)]) as never,
			streamOptions(sessionId) as never,
		));
		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[2]?.previous_response_id, "resp_recovered");
	} finally {
		restoreWebSocket();
	}
});
