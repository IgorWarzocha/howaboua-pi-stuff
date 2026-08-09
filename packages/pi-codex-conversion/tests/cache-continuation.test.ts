import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildCachedWebSocketRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, doneMessage, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("cache continuation requires matching model and reasoning", () => {
	const userInput = { role: "user", content: [{ type: "input_text", text: "first" }] };
	const assistantOutput = { type: "message", role: "assistant", content: [{ type: "output_text", text: "answer" }] };
	const base = {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		input: [userInput],
		text: { verbosity: "low" },
		include: [],
		tool_choice: "auto" as const,
		parallel_tool_calls: false,
		reasoning: { effort: "low" },
	};
	const continuation = { lastRequestBody: base, lastResponseId: "resp_base", lastResponseItems: [assistantOutput] };
	const nextInput = [...base.input, assistantOutput, { role: "user", content: [{ type: "input_text", text: "next" }] }];
	const matching = buildCachedWebSocketRequestBody(continuation, { ...base, input: nextInput });
	assert.equal(matching.decision, "delta");
	assert.equal(matching.body.previous_response_id, "resp_base");
	assert.deepEqual(matching.body.input, nextInput.slice(-1));
	for (const changed of [
		{ ...base, model: "gpt-5.6-sol", input: nextInput },
		{ ...base, reasoning: { effort: "high" }, input: nextInput },
	]) {
		const result = buildCachedWebSocketRequestBody(continuation, changed);
		assert.equal(result.decision, "body_mismatch");
		assert.equal(result.body.previous_response_id, undefined);
		assert.deepEqual(result.body.input, nextInput);
	}
});

test("continuation sends only a pending custom-tool output", () => {
	const userInput = { role: "user", content: [{ type: "input_text", text: "first" }] };
	const requestBody = {
		model: "gpt-5.6-luna",
		store: false,
		stream: true,
		input: [userInput],
		text: { verbosity: "low" },
		include: [],
		tool_choice: "auto" as const,
		parallel_tool_calls: false,
		reasoning: { effort: "low" },
	};
	const providerToolCall = {
		type: "custom_tool_call",
		id: "ctc_tool",
		call_id: "call_tool",
		name: "exec",
		input: 'text("tool result")',
		status: "completed",
		internal_chat_message_metadata_passthrough: { turn_id: "turn_tool" },
	};
	const reconstructedToolCall = {
		type: "custom_tool_call",
		id: "ctc_tool",
		call_id: "call_tool",
		name: "exec",
		input: 'text("tool result")',
	};
	const toolOutput = { type: "custom_tool_call_output", call_id: "call_tool", output: "tool result" };

	const result = buildCachedWebSocketRequestBody({
		lastRequestBody: requestBody,
		lastResponseId: "resp_tool",
		lastResponseItems: [providerToolCall],
	}, { ...requestBody, input: [userInput, reconstructedToolCall, toolOutput] });

	assert.equal(result.decision, "delta");
	assert.equal(result.body.previous_response_id, "resp_tool");
	assert.deepEqual(result.body.input, [toolOutput]);
});

test("WebSocket continuations never cross session IDs", async () => {
	const restoreWebSocket = installScriptedWebSocket([
		textResponse("resp_session_a", "session A"),
		textResponse("resp_session_b", "session B"),
	]);
	try {
		const registered = createRegisteredCodexProvider({ codeMode: true });
		const firstUser = user("session A user", 1);
		const assistant = doneMessage(await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser]) as never,
			streamOptions("session-a") as never,
		)));
		await collectStream(registered.provider.streamSimple(
			model as never,
			context([firstUser, assistant as AgentMessage, user("session B user", 2)]) as never,
			streamOptions("session-b") as never,
		));

		assert.equal(ScriptedWebSocket.opened, 2);
		assert.equal(sentFrames()[1]?.previous_response_id, undefined);
		assert.ok((sentFrames()[1]?.input?.length ?? 0) > 3, "a new session must send its full independent input");
	} finally {
		restoreWebSocket();
	}
});
