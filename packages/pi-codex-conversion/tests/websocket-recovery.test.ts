import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	fakeJwt,
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

test("cached WebSockets stay isolated by Codex account", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		[textResponse("resp_account_1", "one"), textResponse("resp_account_1_next", "one next")],
		textResponse("resp_account_2", "two"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "account-isolation";
		const firstContext = context([user("same user", 1)]);
		const first = await collectStream(registered.provider.streamSimple(model as never, firstContext as never, streamOptions(sessionId) as never));
		const firstMessage = doneMessage(first);
		const secondAccount = fakeJwt({ "https://api.openai.com/auth": { chatgpt_account_id: "acct_2" } });
		await collectStream(registered.provider.streamSimple(model as never, firstContext as never, { ...streamOptions(sessionId), apiKey: secondAccount } as never));
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("same user", 1), firstMessage as AgentMessage, user("next", 2)]) as never,
			streamOptions(sessionId) as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[2]?.previous_response_id, "resp_account_1");
	} finally {
		restoreWebSocket();
	}
});

test("cached WebSockets stay isolated by resolved endpoint", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		textResponse("resp_route_1", "one"),
		textResponse("resp_route_2", "two"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const sessionId = "route-isolation";
		const requestContext = context([user("same user", 1)]);
		await collectStream(registered.provider.streamSimple(model as never, requestContext as never, streamOptions(sessionId) as never));
		await collectStream(registered.provider.streamSimple(
			{ ...model, baseUrl: "https://alternate.example/backend-api" } as never,
			requestContext as never,
			streamOptions(sessionId) as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
	} finally {
		restoreWebSocket();
	}
});

test("incomplete Codex responses distinguish output truncation from provider failure", async () => {
	const incomplete = (reason: string) => (socket: ScriptedWebSocket) => socket.emitJson({
		type: "response.incomplete",
		response: {
			id: `resp_${reason}`,
			status: "incomplete",
			incomplete_details: { reason },
			usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 },
		},
	});
	const restoreWebSocket = installScriptedWebSocket([incomplete("max_output_tokens"), incomplete("content_filter")]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const truncated = await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("truncate", 1)]) as never,
			streamOptions("incomplete-length") as never,
		));
		const failed = await collectStream(registered.provider.streamSimple(
			model as never,
			context([user("filter", 1)]) as never,
			streamOptions("incomplete-error") as never,
		));

		assert.equal(doneMessage(truncated).stopReason, "length");
		assert.equal((failed.at(-1) as { type?: string }).type, "error");
		assert.match((failed.at(-1) as { error?: { errorMessage?: string } }).error?.errorMessage ?? "", /content_filter/);
		assert.equal(ScriptedWebSocket.opened, 2);
	} finally {
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
