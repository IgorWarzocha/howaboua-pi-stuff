import assert from "node:assert/strict";
import test from "node:test";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { buildSessionContext, convertToLlm, SessionManager } from "@earendil-works/pi-coding-agent";
import { buildCachedWebSocketRequestBody, buildRequestBody, type ResponsesBody } from "../src/providers/openai-codex-custom-provider.ts";
import { CodexDeveloperMessageBridge } from "../src/adapter/developer-messages.ts";
import { codexReasoningUpdates, hasPendingCodexReasoningUpdate, recordCodexReasoningUpdate, normalizeCodexConfigurationUpdates } from "../src/adapter/reasoning-updates.ts";
import { applyResponsesLiteRequest } from "../src/providers/openai-codex/responses-lite.ts";
import { serializeMessagesToResponsesInput } from "../src/adapter/compaction/serializer.ts";
import { createAutoReasoning } from "../src/adapter/auto-reasoning.ts";
import { DEFAULT_CODEX_CONVERSION_CONFIG } from "../src/adapter/activation/config.ts";
import { resolveCodexRuntimePlan } from "../src/adapter/activation/runtime-plan.ts";
import {
	ScriptedWebSocket,
	collectStream,
	createRegisteredCodexProvider,
	installScriptedWebSocket,
} from "./openai-codex-test-support.ts";
import { context, doneMessage, model, sentFrames, streamOptions, textResponse, user } from "./websocket-test-support.ts";

test("request reasoning must match; persisted Astra updates extend the input instead", async () => {
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

	const astra = { ...model, id: "gpt-6-astra" };
	const session = SessionManager.inMemory("/repo");
	let level: "low" | "medium" | "high" = "low";
	const pi = {
		getThinkingLevel: () => level,
		setThinkingLevel: (next: typeof level) => {
			const previous = level;
			level = next;
			recordCodexReasoningUpdate(pi, ctx, messages(), previous);
		},
		sendMessage: (message: any, options: unknown) => {
			assert.deepEqual(options, { triggerTurn: false });
			assert.equal(message.display, false);
			session.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
		},
	} as never;
	const ctx = { model: astra, sessionManager: session } as never;
	const messages = () => buildSessionContext(session.getBranch()).messages;
	const config = structuredClone(DEFAULT_CODEX_CONVERSION_CONFIG);
	assert.equal(resolveCodexRuntimePlan({ model: astra }, config).autoReasoning, false);
	config.tools.autoReasoning = true;
	for (const executionMode of ["normal", "code", "notebook"] as const) {
		const plan = resolveCodexRuntimePlan({ model: astra }, config, executionMode);
		assert.equal(plan.autoReasoning, true);
		assert.equal(plan.toolNames.some((name) => name === "change_reasoning"), executionMode === "normal");
		assert.equal(resolveCodexRuntimePlan({ model }, config, executionMode).autoReasoning, false);
		assert.equal(resolveCodexRuntimePlan({ model: { ...astra, api: "openai-responses" } }, config, executionMode).autoReasoning, false);
	}
	const auto = createAutoReasoning(pi, { config, executionMode: "normal" } as never);
	const build = (bridge = new CodexDeveloperMessageBridge()) => {
		const body = buildRequestBody(astra, {
			systemPrompt: "Stable instructions",
			messages: convertToLlm(bridge.prepare(messages(), true, astra)),
		}, { reasoning: level, sessionId: session.getSessionId() });
		return applyResponsesLiteRequest(bridge.rewritePayload(body) as ResponsesBody);
	};
	session.appendMessage(user("first", 1) as never);
	const initial = build();
	session.appendMessage({ role: "assistant", content: [{ type: "text", text: "answer" }], api: astra.api, provider: astra.provider, model: astra.id, stopReason: "stop", timestamp: 2, usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
	const baseline = build().input;
	auto.begin(ctx);
	await auto.tool.execute("raise", { level: "high" }, undefined, undefined, ctx);
	auto.begin(ctx); // Retry/compaction does not replace the user floor.
	await auto.tool.execute("lower", { level: "medium" }, undefined, undefined, ctx);
	const persistedCount = session.getBranch().length;
	recordCodexReasoningUpdate(pi, ctx, messages());
	assert.equal(session.getBranch().length, persistedCount);
	assert.equal(hasPendingCodexReasoningUpdate(messages()), true);
	session.appendMessage(user("next", 3) as never);
	const updated = build();
	assert.deepEqual(updated.reasoning, initial.reasoning);
	assert.equal(updated.prompt_cache_key, initial.prompt_cache_key);
	assert.deepEqual(updated.input.slice(0, baseline.length), baseline);
	const update = { type: "configuration_update", reasoning: { effort: "medium" } };
	assert.deepEqual(updated.input.slice(baseline.length, -1), [update]);
	assert.equal(codexReasoningUpdates(messages(), astra)[0]?.initialEffort, "low");
	assert.deepEqual(build(), updated, "resume reconstructs native items independently of carrier secrets");
	assert.deepEqual(serializeMessagesToResponsesInput(astra, messages()).slice(-2), updated.input.slice(-2));
	const result = buildCachedWebSocketRequestBody({ lastRequestBody: initial, lastResponseId: "low_response", lastResponseItems: baseline.slice(initial.input.length) }, updated);
	assert.equal(result.decision, "delta");
	assert.deepEqual(result.body.input, updated.input.slice(baseline.length));
	assert.equal(result.body.previous_response_id, "low_response");
	auto.settle(ctx);
	assert.equal(level, "low");
	assert.equal(codexReasoningUpdates(messages(), astra).at(-1)?.effort, "low");
	level = "high";
	auto.begin(ctx);
	const floored = await auto.tool.execute("floor", { level: "low" }, undefined, undefined, ctx);
	assert.deepEqual(floored.details, { level: "high", floor: "high" });
	auto.settle(ctx);
	config.tools.autoReasoning = false;
	await assert.rejects(auto.tool.execute("disabled", { level: "low" }, undefined, undefined, ctx), /requires Auto reasoning/);
	assert.throws(() => normalizeCodexConfigurationUpdates({ ...updated, truncation: "auto" }), /automatic truncation/);
	assert.throws(() => normalizeCodexConfigurationUpdates({ ...updated, context_management: [{ type: "compaction" }] }), /automatic compaction/);
	assert.equal(normalizeCodexConfigurationUpdates({ ...updated, model: "gpt-5.6-sol" }).input.some((item: any) => item.type === "configuration_update"), false);
	assert.equal(new CodexDeveloperMessageBridge().prepare(messages(), true, model).some((message) => message.role === "custom"), false);
	level = "high";
	recordCodexReasoningUpdate(pi, ctx, [], "medium");
	assert.equal(codexReasoningUpdates(messages(), astra).at(-1)?.initialEffort, "medium", "a fresh projected window must not inherit the previous window's baseline");
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
