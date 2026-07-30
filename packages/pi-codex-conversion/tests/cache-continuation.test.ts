import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { buildCachedWebSocketRequestBody } from "../src/providers/openai-codex-custom-provider.ts";
import {
	ScriptedWebSocket,
	codeModeTools,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, doneMessage, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("cache continuation rejects meaningful prompt, tool, and persisted-history rewrites", async () => {
	const cases: Array<{
		name: string;
		mutate: (base: { systemPrompt: string; tools: typeof codeModeTools; messages: AgentMessage[] }) => void;
	}> = [
		{
			name: "system prompt",
			mutate: (base) => { base.systemPrompt = "Changed instructions"; },
		},
		{
			name: "tool schema",
			mutate: (base) => {
				base.tools = structuredClone(codeModeTools) as typeof codeModeTools;
				(base.tools[1] as { description: string }).description = "Changed wait contract";
			},
		},
		{
			name: "tool order",
			mutate: (base) => { base.tools = [...codeModeTools].reverse() as typeof codeModeTools; },
		},
		{
			name: "assistant history",
			mutate: (base) => {
				const assistant = structuredClone(base.messages[1]!) as AssistantMessage;
				const text = assistant.content.find((item) => item.type === "text");
				if (text?.type === "text") text.text = "rewritten assistant history";
				base.messages[1] = assistant as AgentMessage;
			},
		},
	];

	for (const candidate of cases) {
		const restoreWebSocket = installScriptedWebSocket([[
			textResponse("resp_base", "stable assistant"),
			textResponse("resp_changed", "changed"),
		]]);
		try {
			const registered = createRegisteredCodexProvider({ codeMode: true });
			const sessionId = `invalidate-${candidate.name}`;
			const firstUser = user("first user", 1);
			const assistant = doneMessage(await collectStream(
				registered.provider.streamSimple(model as never, context([firstUser]) as never, streamOptions(sessionId) as never),
			));
			const base = {
				systemPrompt: "Stable instructions",
				tools: codeModeTools,
				messages: [firstUser, assistant as AgentMessage, user("new user", 2)],
			};
			candidate.mutate(base);
			await collectStream(registered.provider.streamSimple(
				model as never,
				context(base.messages, base.systemPrompt, base.tools) as never,
				streamOptions(sessionId) as never,
			));

			const changedFrame = sentFrames()[1]!;
			assert.equal(changedFrame.previous_response_id, undefined, `${candidate.name} must invalidate continuation`);
			assert.ok((changedFrame.input?.length ?? 0) > 1, `${candidate.name} must be sent in full`);
		} finally {
			restoreWebSocket();
		}
	}
});

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
